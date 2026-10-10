#!/bin/sh
set -eu

if [ "$#" -ne 1 ]; then
    echo "Usage: $0 /absolute/path/to/cloudflared-config.yml" >&2
    exit 2
fi
case "$1" in
    /*) ;;
    *) echo "Configuration path must be absolute." >&2; exit 2 ;;
esac
if [ ! -f "$1" ] || [ ! -r "$1" ]; then
    echo "Configuration must be a readable file: $1" >&2
    exit 2
fi
if ! command -v cloudflared >/dev/null 2>&1; then
    echo "Install cloudflared before starting the tunnel; see cloudflare.md." >&2
    exit 127
fi
if LC_ALL=C grep -Eq '<(TUNNEL_UUID|ABSOLUTE_TUNNEL_CREDENTIALS_JSON_PATH|PUBLIC_API_HOSTNAME|API_ORIGIN)>' "$1"; then
    echo "Replace all configuration placeholders before starting the tunnel." >&2
    exit 2
fi

cloudflared tunnel --config "$1" ingress validate
# Replace the shell so foreground shutdown signals reach the connector.
exec cloudflared tunnel --config "$1" run
