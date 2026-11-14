#!/usr/bin/env bash
# Saves the deck as a PDF: one slide per page, every build shown.
# Usage: bash presentation/export-pdf.sh [output.pdf]
# Needs Chrome or Chromium. Set CHROME=/path/to/chrome if it is not found.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
out="${1:-$here/reviewer-controls-pitch.pdf}"

browser="${CHROME:-}"
if [ -z "$browser" ]; then
  for name in google-chrome google-chrome-stable chromium chromium-browser; do
    if command -v "$name" >/dev/null 2>&1; then browser="$(command -v "$name")"; break; fi
  done
fi
if [ -z "$browser" ]; then
  for path in \
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
    "$HOME"/.cache/ms-playwright/chromium-*/chrome-linux*/chrome; do
    if [ -x "$path" ]; then browser="$path"; break; fi
  done
fi
if [ -z "$browser" ]; then
  echo "No Chrome or Chromium found. Set CHROME=/path/to/chrome, or open" >&2
  echo "presentation/index.html in a browser, press P and choose Save as PDF." >&2
  exit 1
fi

"$browser" --headless=new --disable-gpu --no-pdf-header-footer \
  --virtual-time-budget=8000 --run-all-compositor-stages-before-draw \
  --print-to-pdf="$out" "file://$here/index.html?print" 2>/dev/null

echo "Saved $out"
