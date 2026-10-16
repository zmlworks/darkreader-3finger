#!/bin/sh
# 実拡張の E2E: web-ext run でヘッドレス Firefox に一時読み込みし、ページから合成 TouchEvent を送る。
#   sh test/e2e/run.sh            … Dark Reader スタブ（ページ側）で基本の流れ
#   sh test/e2e/run.sh remember   … 「記憶する」をオンにした複製で sitemark.js の動的登録（scripting API）を確認
#   DR_XPI=path/to/darkreader.xpi sh test/e2e/run.sh real   … 本物の Dark Reader を入れたプロファイルで確認（テスト専用、配布物には含めない）
# 結果は /tmp/dr3f-e2e.log
set -e
cd "$(dirname "$0")/../.."
MODE=${1:-stub}
FF=${FIREFOX:-$(ls -d ~/.cache/ms-playwright/firefox-*/firefox/firefox | tail -1)}
SRCDIR=src; URL="http://127.0.0.1:8765/page.html"; EXTRA=""
TMP=$(mktemp -d)
if [ "$MODE" = remember ]; then
  cp -r src "$TMP/src"; SRCDIR="$TMP/src"; URL="$URL?remember=1"
  printf '\napi.storage.local.set({ rememberDark: true }); // e2e only\n' >> "$SRCDIR/background.js"
  printf '\ndocument.documentElement.setAttribute("data-e2e-sitemark", "1"); // e2e only\n' >> "$SRCDIR/sitemark.js"
fi
if [ -n "$NO_FB_SUPPRESS" ]; then  # 比較用: fallback の除去を無効にした複製
  [ "$SRCDIR" = src ] && { cp -r src "$TMP/src"; SRCDIR="$TMP/src"; }
  sed -i 's/^  function suppressFallback(on) {/  function suppressFallback(on) { return;/' "$SRCDIR/content.js"
fi
if [ "$MODE" = real ]; then
  mkdir -p "$TMP/profile/extensions"; cp "${DR_XPI:?DR_XPI=...}" "$TMP/profile/extensions/addon@darkreader.org.xpi"
  printf 'user_pref("extensions.autoDisableScopes", 0);\nuser_pref("extensions.enabledScopes", 15);\nuser_pref("ui.systemUsesDarkTheme", %s);\nuser_pref("layout.css.prefers-color-scheme.content-override", %s);\n' "${SYSDARK:-1}" "$([ "${SYSDARK:-1}" = 1 ] && echo 0 || echo 1)" > "$TMP/profile/user.js"
  EXTRA="--firefox-profile=$TMP/profile"; URL="$URL?real=1&probe=1&wait=${WAIT:-2500}"
fi
rm -f /tmp/dr3f-e2e.log
python3 test/e2e/server.py >/dev/null 2>&1 & SRV=$!
timeout 60 npx web-ext run -s "$SRCDIR" --firefox="$FF" --arg=-headless --no-reload $EXTRA \
  --pref=dom.w3c_touch_events.enabled=1 --start-url "$URL" >/tmp/webext-run.log 2>&1 &
WX=$!
for i in $(seq 1 60); do grep -q '"done"' /tmp/dr3f-e2e.log 2>/dev/null && break; sleep 1; done
kill $WX $SRV 2>/dev/null || true; pkill -f "$FF" 2>/dev/null || true
rm -rf "$TMP"
cat /tmp/dr3f-e2e.log
L=/tmp/dr3f-e2e.log
ok() { grep -q "$1" $L || { echo "E2E FAIL: missing $1"; exit 1; }; }
ok '"name":"loaded (default off)","dr":false,"lock":true,"lockInHead":true'
ok '"name":"after enable reload","dr":true,"lock":false'
ok '"name":"after off tap","dr":false,"lock":true,"lockInHead":true'
if [ "$MODE" = remember ]; then
  ok '"name":"remembered: dark from load without tab state","dr":true,"lock":false'
  grep '"name":"remembered: dark from load' $L | grep -q '"sitemark":"1"' || { echo "E2E FAIL: sitemark.js did not run"; exit 1; }
  ok '"name":"after reload (unremembered, off)","dr":false,"lock":true'
else
  ok '"name":"after reload (still off)","dr":false,"lock":true'
fi
[ "$MODE" != real ] || ok '"name":"lock removed without reload","dr":false,"lock":false'
# オフの読み込みでは最初の描画フレームからロックがあり、Dark Reader の暗い仮スタイル（fallback）も無い = ちらつきなし
[ -n "$NO_FB_SUPPRESS" ] || grep '"name":"loaded (default off)"' $L | grep -q '"first":{"lock":true,"fallback":false,"bg":"rgba(0, 0, 0, 0)"}' || { echo "E2E FAIL: flash on first frame"; exit 1; }
! grep -q 'NO RELOAD HAPPENED' $L || { echo "E2E FAIL: no reload"; exit 1; }
echo "E2E PASS ($MODE)"
