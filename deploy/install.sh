#!/usr/bin/env bash
# usage: sudo BUN="$(command -v bun)" deploy/install.sh
# Installs or updates the app in /opt/btg from this checkout, builds it, applies migrations and (re)starts btg.service.
# First run: copies .env.example to /etc/btg/btg.env (root, 0600) and stops so you can fill it in. Rerun after editing.
# Sizes btg.service to this machine (btg.service.d/size.conf) and checks the sandbox prerequisites before building.
# Works with a local Postgres (deploy/setup-postgres.sh) or any managed Postgres URL in DATABASE_URL.
# Idempotent: safe to rerun for every update (git pull, then rerun).
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/btg}"
ENV_FILE="${ENV_FILE:-/etc/btg/btg.env}"
repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

die() { echo "error: $*" >&2; exit 1; }
log() { echo "==> $*"; }
warn() { echo "warning: $*" >&2; }
env_value() { grep -E "^$1=" "$ENV_FILE" | tail -n 1 | cut -d= -f2- | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/"; }

[ "$(id -u)" -eq 0 ] || die "run as root (installs to $APP_DIR and /etc/systemd/system)"
for cmd in rsync systemctl curl install runuser; do
  command -v "$cmd" >/dev/null || die "$cmd not found in PATH"
done

missing=()
for pair in bwrap:bubblewrap prlimit:util-linux /usr/bin/python3:python3 pdftotext:poppler-utils gs:ghostscript pg_dump:postgresql-client; do
  command -v "${pair%%:*}" >/dev/null || missing+=("${pair#*:}")
done
[ "${#missing[@]}" -eq 0 ] || die "missing packages; run: apt install -y ${missing[*]}"

# Each sandbox run may use up to 1G, so the app needs at least 2G of its own. A "4 GB" VPS reports about 3.7 GiB in MemTotal.
mem_mib=$(( $(awk '/^MemTotal:/ { print $2 }' /proc/meminfo) / 1024 ))
[ "$mem_mib" -ge 3500 ] || die "this machine has ${mem_mib} MiB of RAM; at least 4 GB is required"
cpus="$(nproc)"
pg_local=0
systemctl cat postgresql >/dev/null 2>&1 && pg_local=1
memory_max=$(( mem_mib - 1536 ))
[ "$pg_local" -eq 0 ] || memory_max=$(( memory_max - mem_mib / 4 ))
[ "$memory_max" -ge 2048 ] || memory_max=2048
cpu_quota=$(( cpus * 80 ))

if [ ! -x /usr/local/bin/bun ]; then
  src="${BUN:-$(command -v bun || true)}"
  [ -n "$src" ] || die "bun not found; rerun as: sudo BUN=\"\$(command -v bun)\" $0"
  src="$(readlink -f "$src")"
  "$src" --version >/dev/null || die "$src is not a working bun binary"
  log "installing $src as /usr/local/bin/bun"
  install -m 0755 "$src" /usr/local/bin/bun
fi
BUN_BIN=/usr/local/bin/bun

if ! id btg >/dev/null 2>&1; then
  log "creating system user btg"
  useradd --system --home-dir "$APP_DIR" --no-create-home --shell /usr/sbin/nologin btg
fi

probe_userns() { (cd / && runuser -u btg -- bwrap --unshare-all --die-with-parent --ro-bind / / true) >/dev/null 2>&1; }
probe_layout() {
  (cd / && runuser -u btg -- bwrap --unshare-all --die-with-parent --ro-bind /usr /usr --symlink usr/lib /lib \
    --symlink usr/lib /lib64 --symlink usr/bin /bin --dev /dev /usr/bin/python3 -I -c pass) >/dev/null 2>&1
}
log "checking the bubblewrap sandbox as user btg"
if ! probe_userns && [ "$(sysctl -n kernel.apparmor_restrict_unprivileged_userns 2>/dev/null || echo 0)" = "1" ]; then
  command -v apparmor_parser >/dev/null || die "apparmor_parser not found; run: apt install -y apparmor"
  log "installing AppArmor profile /etc/apparmor.d/btg-bwrap (user namespaces for /usr/bin/bwrap)"
  # SEC: grants the userns permission to /usr/bin/bwrap only, following Ubuntu's documented unprivileged-userns exception
  # pattern. kernel.apparmor_restrict_unprivileged_userns stays 1, so every other program is still restricted.
  cat >/etc/apparmor.d/btg-bwrap <<'PROFILE'
# Written by BridgeToGrowth deploy/install.sh: bubblewrap needs unprivileged user namespaces for the code and PDF sandbox.
abi <abi/4.0>,
include <tunables/global>

profile btg-bwrap /usr/bin/bwrap flags=(unconfined) {
  userns,

  include if exists <local/btg-bwrap>
}
PROFILE
  apparmor_parser -r /etc/apparmor.d/btg-bwrap
fi
if ! probe_userns; then
  warn "bwrap cannot create user namespaces as btg; code exercises and PDF attachments will be disabled"
elif ! probe_layout; then
  warn "bwrap works, but /usr/bin/python3 does not start in the sandbox's filesystem layout, which maps /lib64 to usr/lib (x86_64 Ubuntu keeps its loader in /usr/lib64); code exercises and PDF attachments will be disabled"
fi
[ "$(stat -fc %T /sys/fs/cgroup)" = "cgroup2fs" ] \
  || warn "/sys/fs/cgroup is not cgroup v2; the sandbox will not start, so code exercises and PDF attachments will be disabled"

if [ ! -f "$ENV_FILE" ]; then
  install -d -m 0755 "$(dirname "$ENV_FILE")"
  install -m 0600 -o root -g root "$repo/.env.example" "$ENV_FILE"
  sed -i 's/^NODE_ENV=.*/NODE_ENV=production/' "$ENV_FILE"
  die "created $ENV_FILE from .env.example. Fill in production values (see README), then rerun."
fi
[ "$(stat -c '%U %a' "$ENV_FILE")" = "root 600" ] || die "$ENV_FILE must be owned by root with mode 0600"
[ "$(env_value NODE_ENV)" = "production" ] || die "NODE_ENV=production is required in $ENV_FILE (EnvironmentFile overrides the unit's Environment=)"
PORT="$(env_value PORT)"
PORT="${PORT:-3000}"

log "syncing $repo to $APP_DIR"
install -d -m 0755 "$APP_DIR"
rsync -a --delete --exclude '.git/' --exclude 'node_modules/' --exclude 'dist/' --exclude '.env' --exclude '.env.*' "$repo/" "$APP_DIR/"

log "installing dependencies and building"
(cd "$APP_DIR" && "$BUN_BIN" install --frozen-lockfile && "$BUN_BIN" run build)
chown -R root:root "$APP_DIR"
chmod -R go-w,go+rX "$APP_DIR"

log "applying migrations"
(cd "$APP_DIR" && "$BUN_BIN" --env-file="$ENV_FILE" scripts/migrate.ts)

log "checking pg_dump against the database server version"
# shellcheck disable=SC2016 # the backticks are a JS tagged template, not shell
server_major="$(cd "$APP_DIR" && "$BUN_BIN" --env-file="$ENV_FILE" -e 'const db = new Bun.SQL(process.env.DATABASE_URL ?? ""); const [row] = await db`SHOW server_version_num`; console.log(Math.floor(Number(row.server_version_num) / 10000)); await db.close();')" \
  || die "could not read the database server version"
dump_major="$(pg_dump --version | sed -nE 's/^pg_dump \(PostgreSQL\) ([0-9]+).*/\1/p')"
[[ "$server_major" =~ ^[0-9]+$ && "$dump_major" =~ ^[0-9]+$ ]] || die "could not parse the pg_dump or server version"
[ "$dump_major" -ge "$server_major" ] \
  || die "pg_dump is version $dump_major but the database server is $server_major; nightly backups would fail. Install postgresql-client-$server_major (PGDG apt repository) and rerun"

log "installing systemd units"
install -m 0644 "$APP_DIR"/deploy/systemd/btg.service "$APP_DIR"/deploy/systemd/btg-backup.service "$APP_DIR"/deploy/systemd/btg-backup.timer /etc/systemd/system/
pg_mode=managed
[ "$pg_local" -eq 0 ] || pg_mode=local
log "sizing btg.service for ${mem_mib} MiB, ${cpus} CPUs, ${pg_mode} Postgres: MemoryMax=${memory_max}M CPUQuota=${cpu_quota}%"
install -d -m 0755 /etc/systemd/system/btg.service.d
printf '# Written by deploy/install.sh; rerun it to recompute.\n[Service]\nMemoryMax=%sM\nCPUQuota=%s%%\n' "$memory_max" "$cpu_quota" >/etc/systemd/system/btg.service.d/size.conf
chmod 0644 /etc/systemd/system/btg.service.d/size.conf
systemctl daemon-reload
systemctl enable btg.service btg-backup.timer >/dev/null
systemctl start btg-backup.timer
systemctl restart btg.service

log "waiting for http://127.0.0.1:$PORT/api/health"
for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then
    log "btg.service is up. Next: sudo deploy/setup-proxy.sh \$HOST"
    exit 0
  fi
  sleep 1
done
die "btg.service did not become healthy; see journalctl -u btg -n 50"
