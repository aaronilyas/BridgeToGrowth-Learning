#!/usr/bin/env bash
# usage: PGHOST=.. PGUSER=.. PGPASSWORD=.. scripts/db-setup.sh <btg-role-password>
# Uses standard libpq env vars; defaults to the local superuser via the default socket.
set -euo pipefail
pw="${1:-}"
[ -n "$pw" ] || { echo "usage: $0 <btg-role-password>" >&2; exit 2; }

psql -X -v ON_ERROR_STOP=1 -v pw="$pw" -d postgres <<'SQL'
SELECT format('CREATE ROLE btg LOGIN PASSWORD %L', :'pw')
  WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'btg') \gexec
SELECT format('ALTER ROLE btg LOGIN PASSWORD %L', :'pw') \gexec
SELECT 'CREATE DATABASE btg OWNER btg'
  WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'btg') \gexec
SELECT 'CREATE DATABASE btg_test OWNER btg'
  WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'btg_test') \gexec
SQL

for db in btg btg_test; do
  psql -X -v ON_ERROR_STOP=1 -d "$db" -c 'CREATE EXTENSION IF NOT EXISTS citext' >/dev/null
done

cat <<'MSG'
Confirm these in your Postgres config (this script never edits it):
  postgresql.conf: listen_addresses = 'localhost'
  pg_hba.conf:     host btg btg 127.0.0.1/32 scram-sha-256
MSG
