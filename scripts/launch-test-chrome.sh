#!/bin/sh
# Opens a separate Chrome window in its own test profile (your normal Chrome
# profile is not touched). Sign-ins and the unpacked extension are remembered in
# the profile folder below, so you only load the extension once.
#
# Branded Chrome (137+) ignores --load-extension, so the first time:
#   chrome://extensions -> turn on Developer mode -> Load unpacked -> pick this folder.
#
# Usage: scripts/launch-test-chrome.sh [url ...]

set -e
EXT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PROFILE="${STA_PROFILE:-$HOME/.cache/send-to-agent-chrome}"
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"

mkdir -p "$PROFILE"
"$CHROME" \
  --user-data-dir="$PROFILE" \
  --no-first-run \
  --no-default-browser-check \
  "${@:-chrome://extensions}" >/dev/null 2>&1 &
echo "Test Chrome started (profile: $PROFILE)"
echo "If Send-to-Agent isn't listed in chrome://extensions, click Load unpacked and pick: $EXT_DIR"
