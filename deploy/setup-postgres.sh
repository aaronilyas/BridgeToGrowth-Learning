#!/usr/bin/env bash
# usage: sudo deploy/setup-postgres.sh
# Local-database mode: installs Ubuntu's postgresql package when it is missing, binds it to localhost, allows the btg role
# over 127.0.0.1 with scram-sha-256, tunes it for a small server, and creates the btg role, the btg and btg_test databases and citext.
# Writes DATABASE_URL into /etc/btg/btg.env (creating that file from .env.example if needed) only while it is empty or the
# .env.example placeholder. Once DATABASE_URL holds a real value, the URL and the role password are left alone.
# Idempotent: a rerun changes nothing unless RAM changed. Skip this script when you use a managed Postgres.
set -euo pipefail

ENV_FILE="${ENV_FILE:-/etc/btg/btg.env}"
PG_PORT=5432
repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

die() { echo "error: $*" >&2; exit 1; }
log() { echo "==> $*"; }
env_value() { grep -E "^$1=" "$ENV_FILE" | tail -n 1 | cut -d= -f2- | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/"; }
as_postgres() { (cd / && runuser -u postgres -- "$@"); }

[ "$(id -u)" -eq 0 ] || die "run as root"
[ -f "$repo/scripts/db-setup.sh" ] || die "missing $repo/scripts/db-setup.sh"
[ -f "$repo/.env.example" ] || die "missing $repo/.env.example"
for cmd in systemctl runuser openssl install; do
  command -v "$cmd" >/dev/null || die "$cmd not found in PATH"
done

if ! dpkg-query -W -f='${Status}' postgresql 2>/dev/null | grep -q 'install ok installed'; then
  command -v apt-get >/dev/null || die "postgresql is not installed and apt-get is unavailable"
  log "installing postgresql"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  apt-get install -y postgresql
fi
command -v pg_lsclusters >/dev/null || die "pg_lsclusters not found; is postgresql-common installed?"

read -r PG_VER PG_CLUSTER < <(pg_lsclusters --no-header | awk -v port="$PG_PORT" '$3 == port { print $1, $2; exit }') || true
[ -n "${PG_VER:-}" ] || die "no Postgres cluster listens on port $PG_PORT (see pg_lsclusters)"
[ "$PG_VER" -ge 16 ] || die "Postgres $PG_VER is too old; 16 or newer is required"
conf_dir="/etc/postgresql/$PG_VER/$PG_CLUSTER"
unit="postgresql@$PG_VER-$PG_CLUSTER"
log "using Postgres $PG_VER cluster $PG_CLUSTER ($conf_dir)"

grep -qE "^[[:space:]]*include_dir[[:space:]]*=[[:space:]]*'conf\.d'" "$conf_dir/postgresql.conf" \
  || printf "\ninclude_dir = 'conf.d'\n" >>"$conf_dir/postgresql.conf"
install -d -o postgres -g postgres -m 0755 "$conf_dir/conf.d"

mem_mib=$(( $(awk '/^MemTotal:/ { print $2 }' /proc/meminfo) / 1024 ))
shared_mib=$(( mem_mib * 15 / 100 ))
[ "$shared_mib" -le 2048 ] || shared_mib=2048
cache_mib=$(( mem_mib * 40 / 100 ))

dropin="$conf_dir/conf.d/90-btg.conf"
want="$(mktemp)"
trap 'rm -f "$want"' EXIT
# SEC: listen on loopback only; Caddy is the only public ingress and the firewall never opens 5432.
cat >"$want" <<CONF
# Written by deploy/setup-postgres.sh for a ${mem_mib} MiB server. Rerun the script to recompute.
listen_addresses = 'localhost'
max_connections = 50
shared_buffers = ${shared_mib}MB
effective_cache_size = ${cache_mib}MB
CONF
restart=0
if ! cmp -s "$want" "$dropin"; then
  log "writing $dropin (shared_buffers ${shared_mib}MB, effective_cache_size ${cache_mib}MB, max_connections 50)"
  install -o postgres -g postgres -m 0644 "$want" "$dropin"
  restart=1
fi

hba="$conf_dir/pg_hba.conf"
reload=0
if ! grep -qE '^[[:space:]]*host[[:space:]]+btg[[:space:]]+btg[[:space:]]+127\.0\.0\.1/32[[:space:]]+scram-sha-256[[:space:]]*$' "$hba"; then
  log "allowing btg@127.0.0.1 in $hba"
  printf '\n# deploy/setup-postgres.sh\nhost btg btg 127.0.0.1/32 scram-sha-256\n' >>"$hba"
  reload=1
fi

systemctl enable postgresql >/dev/null 2>&1 || true
if ! systemctl is-active --quiet "$unit" || [ "$restart" -eq 1 ]; then
  log "restarting $unit"
  systemctl restart "$unit"
elif [ "$reload" -eq 1 ]; then
  log "reloading $unit"
  systemctl reload "$unit"
fi
for _ in $(seq 1 30); do
  as_postgres pg_isready -q -p "$PG_PORT" && break
  sleep 1
done
as_postgres pg_isready -q -p "$PG_PORT" || die "Postgres is not accepting connections; see journalctl -u $unit"

if [ ! -f "$ENV_FILE" ]; then
  log "creating $ENV_FILE from .env.example"
  install -d -m 0755 "$(dirname "$ENV_FILE")"
  install -m 0600 -o root -g root "$repo/.env.example" "$ENV_FILE"
  sed -i 's/^NODE_ENV=.*/NODE_ENV=production/' "$ENV_FILE"
fi
[ "$(stat -c '%U %G %a' "$ENV_FILE")" = "root root 600" ] || die "$ENV_FILE must be root:root with mode 0600"

placeholder="$(ENV_FILE="$repo/.env.example" env_value DATABASE_URL)"
current="$(env_value DATABASE_URL || true)"

if [ -n "$current" ] && [ "$current" != "$placeholder" ]; then
  log "DATABASE_URL in $ENV_FILE is already set; leaving it and the btg role password unchanged"
  if as_postgres psql -XtAq -p "$PG_PORT" -d postgres -c "SELECT 1 FROM pg_roles WHERE rolname = 'btg'" | grep -q 1; then
    as_postgres psql -XtAq -v ON_ERROR_STOP=1 -p "$PG_PORT" -d postgres >/dev/null <<'SQL'
SELECT 'CREATE DATABASE btg OWNER btg' WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'btg') \gexec
SELECT 'CREATE DATABASE btg_test OWNER btg' WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'btg_test') \gexec
SQL
    for db in btg btg_test; do
      as_postgres env PGOPTIONS='-c client_min_messages=warning' psql -XtAq -v ON_ERROR_STOP=1 -p "$PG_PORT" -d "$db" -c 'CREATE EXTENSION IF NOT EXISTS citext' >/dev/null
    done
  fi
  log "Postgres $PG_VER is ready on 127.0.0.1:$PG_PORT"
  exit 0
fi

# SEC: the password lives only in this shell's memory, db-setup.sh's argv, and the env file. It is never echoed, and
# this script never enables xtrace. db-setup.sh is fed on stdin so the postgres user needs no access to the checkout,
# and its stdout is discarded. Postgres stores only the scram-sha-256 verifier (log_statement stays at its default).
log "creating or updating role btg and databases btg, btg_test"
pw="$(openssl rand -hex 24)"
[[ "$pw" =~ ^[0-9a-f]{48}$ ]] || die "openssl rand failed"
as_postgres env PGPORT="$PG_PORT" bash -s -- "$pw" <"$repo/scripts/db-setup.sh" >/dev/null

log "writing DATABASE_URL to $ENV_FILE"
tmp="$(mktemp "$ENV_FILE.XXXXXX")"
trap 'rm -f "$want" "$tmp"' EXIT
url="postgres://btg:$pw@127.0.0.1:$PG_PORT/btg"
written=0
while IFS= read -r line || [ -n "$line" ]; do
  if [[ "$line" == DATABASE_URL=* ]]; then
    [ "$written" -eq 1 ] && continue
    printf 'DATABASE_URL=%s\n' "$url"
    written=1
  else
    printf '%s\n' "$line"
  fi
done <"$ENV_FILE" >"$tmp"
[ "$written" -eq 1 ] || printf 'DATABASE_URL=%s\n' "$url" >>"$tmp"
unset pw url
chown root:root "$tmp"
chmod 0600 "$tmp"
mv -f "$tmp" "$ENV_FILE"

log "Postgres $PG_VER is ready on 127.0.0.1:$PG_PORT. Fill in the rest of $ENV_FILE, then run deploy/install.sh"
