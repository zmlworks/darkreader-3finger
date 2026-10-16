#!/bin/sh
# 配布用 zip（= xpi）を ../out/ に作る。web-ext lint を通してから固める。
set -e
cd "$(dirname "$0")"
V=$(jq -r .version src/manifest.json)
OUT=../out
mkdir -p "$OUT"
npx web-ext lint -s src --output text >/dev/null 2>&1 || { npx web-ext lint -s src; exit 1; }
rm -f "$OUT/darkreader-3finger-$V.zip" "$OUT/darkreader-3finger-$V.xpi"
(cd src && zip -r -X -q "../$OUT/darkreader-3finger-$V.zip" . -x '.*')
cp "$OUT/darkreader-3finger-$V.zip" "$OUT/darkreader-3finger-$V.xpi"
echo "built $OUT/darkreader-3finger-$V.zip (+ .xpi)"
