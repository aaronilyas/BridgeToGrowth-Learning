#!/bin/sh
# Builds the BridgeToGrowth Learning desktop app for this computer (macOS or Linux).
# Usage: ./make-app.sh     Output: artifacts/
set -eu
cd "$(dirname "$0")"

if ! command -v bun >/dev/null 2>&1; then
  echo "Bun is required but was not found."
  echo "Run ./install.sh instead: it installs Bun and the other prerequisites, then builds the app."
  exit 1
fi

bun install --frozen-lockfile
exec bun scripts/make-app.ts
