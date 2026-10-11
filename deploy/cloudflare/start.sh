#!/bin/sh
set -eu
# Compatibility entry point; connector lifecycle is now owned by Compose.
ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
if [ "$#" -ne 0 ]; then
    echo 'YAML/host-managed tunnels are superseded. Configure root .env and run ./start-backend.sh.' >&2
    exit 2
fi
exec "$ROOT_DIR/start-backend.sh"
