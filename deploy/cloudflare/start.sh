#!/bin/sh
set -eu
# Compatibility entry point; backend lifecycle; the external host connector remains untouched.
ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
if [ "$#" -ne 0 ]; then
    echo 'Configure external-tunnel mode in root .env and run ./start-backend.sh; this wrapper never starts a host connector.' >&2
    exit 2
fi
exec "$ROOT_DIR/start-backend.sh"
