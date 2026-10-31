#!/usr/bin/env bash
# usage: sudo BUN="$(command -v bun)" deploy/install.sh
# Installs or updates the app in /opt/btg from this checkout, builds it, applies migrations and (re)starts btg.service.
# First run: copies .env.example to /etc/btg/btg.env (root, 0600) and stops so you can fill it in. Rerun after editing.
# Idempotent: safe to rerun for every update (git pull, then rerun).
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/btg}"
ENV_FILE="${ENV_FILE:-/etc/btg/btg.env}"
repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

die() { echo "error: $*" >&2; exit 1; }
log() { echo "==> $*"; }
env_value() { grep -E "^$1=" "$ENV_FILE" | tail -n 1 | cut -d= -f2- | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/"; }

[ "$(id -u)" -eq 0 ] || die "run as root (installs to $APP_DIR and /etc/systemd/system)"
for cmd in rsync systemctl curl install; do
  command -v "$cmd" >/dev/null || die "$cmd not found in PATH"
done

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
rsync -a --delete --exclude '.git/' --exclude 'node_modules/' --exclude 'dist/' --exclude '.env' --exclude '.env.*' --exclude 'Example-UI/' --exclude 'prompts/' "$repo/" "$APP_DIR/"

log "installing dependencies and building"
(cd "$APP_DIR" && "$BUN_BIN" install --frozen-lockfile && "$BUN_BIN" run build)
chown -R root:root "$APP_DIR"
chmod -R go-w,go+rX "$APP_DIR"

log "applying migrations"
(cd "$APP_DIR" && "$BUN_BIN" --env-file="$ENV_FILE" scripts/migrate.ts)

log "installing systemd units"
install -m 0644 "$APP_DIR"/deploy/systemd/btg.service "$APP_DIR"/deploy/systemd/btg-backup.service "$APP_DIR"/deploy/systemd/btg-backup.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable btg.service btg-backup.timer >/dev/null
systemctl start btg-backup.timer
systemctl restart btg.service

log "waiting for http://127.0.0.1:$PORT/api/health"
for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then
    log "btg.service is up. Next: sudo deploy/setup-tunnel.sh <your-hostname> (once), then the checklist in deploy/cloudflare-dashboard.md"
    exit 0
  fi
  sleep 1
done
die "btg.service did not become healthy; see journalctl -u btg -n 50"
