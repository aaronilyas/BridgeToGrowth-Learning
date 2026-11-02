#!/bin/bash
# pg_dump -Fc against DATABASE_URL from the environment. Does not print the URL.
set -euo pipefail
umask 0077
[ -n "${DATABASE_URL:-}" ] || { echo "error: DATABASE_URL is not set" >&2; exit 1; }
dest="/var/backups/btg/btg-$(date +%F).dump"
redact() { sed -e 's#postgres\(ql\)\?://[^[:space:]]*#postgres://redacted#g'; }
if ! pg_dump -Fc --dbname="$DATABASE_URL" --file="$dest" 2>&1 | redact >&2; then
  rm -f "$dest"
  exit 1
fi
find /var/backups/btg -type f -name 'btg-*.dump' -mtime +14 -delete
