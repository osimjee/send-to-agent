#!/bin/sh
# Builds the zip to upload to the Chrome Web Store: only the files the extension runs,
# no docs, store assets or scripts. Output: dist/send-to-agent-<version>.zip
set -e
cd "$(dirname "$0")/.."
VERSION=$(python3 -c 'import json; print(json.load(open("manifest.json"))["version"])')
OUT="dist/send-to-agent-$VERSION.zip"
mkdir -p dist
rm -f "$OUT"
zip -q -X -r "$OUT" manifest.json background.js content.js content.css popup.html popup.js icons LICENSE \
  -x '*.DS_Store'
echo "Built $OUT"
unzip -l "$OUT" | tail -n +4 | sed '$d' | sed '$d' | awk '{print "  " $4}'
