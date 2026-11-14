#!/bin/bash
# One-time setup for a new clone. Safe to run again.
# It never reads, creates or prints keys.
set -e
cd "$(dirname "$0")/.."

echo "1/3  Turning on the commit and push checks that block keys"
git config core.hooksPath .githooks
chmod +x .githooks/pre-commit .githooks/pre-push

echo "2/3  Python environment for the backend"
if [ ! -d .venv ]; then
  python3 -m venv .venv
fi
.venv/bin/pip install --quiet -r requirements.txt

echo "3/3  Packages for the page"
npm --prefix web install --no-fund --no-audit

for name in .env keys.env junction-keys.env; do
  if [ -e "$name" ]; then
    echo
    echo "WARNING: '$name' is inside the project folder. Keys must live in ~/.junction-keys.env."
    echo "Move it out now and never commit it."
  fi
done

echo
echo "Done. Key checks are on (core.hooksPath = $(git config core.hooksPath))."
echo "Start the backend and the page as described in README.md."
echo "You do not need keys to run the page. Read the Keys section before asking for them."
