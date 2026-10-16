#!/bin/sh
# 実拡張の E2E: web-ext run でヘッドレス Firefox に一時読み込みし、ページから合成 TouchEvent を送る。
# 結果は /tmp/dr3f-e2e.log（loaded → after 3-finger tap → after reload → after re-enable reload → done）
set -e
cd "$(dirname "$0")/../.."
FF=${FIREFOX:-$(ls -d ~/.cache/ms-playwright/firefox-*/firefox/firefox | tail -1)}
rm -f /tmp/dr3f-e2e.log
python3 test/e2e/server.py & SRV=$!
timeout 40 npx web-ext run -s src --firefox="$FF" --arg=-headless --no-reload \
  --pref=dom.w3c_touch_events.enabled=1 --start-url http://127.0.0.1:8765/page.html >/tmp/webext-run.log 2>&1 &
WX=$!
for i in $(seq 1 40); do grep -q '"done"' /tmp/dr3f-e2e.log 2>/dev/null && break; sleep 1; done
kill $WX $SRV 2>/dev/null || true; pkill -f "$FF" 2>/dev/null || true
cat /tmp/dr3f-e2e.log
grep -q '"name":"after re-enable reload","dr":true,"lock":false' /tmp/dr3f-e2e.log && echo "E2E PASS" || { echo "E2E FAIL"; exit 1; }
