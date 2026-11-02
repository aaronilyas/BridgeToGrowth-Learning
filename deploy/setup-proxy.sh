#!/usr/bin/env bash
# usage: sudo deploy/setup-proxy.sh HOST
# Installs Caddy when it is missing, renders deploy/Caddyfile.tmpl with PORT from /etc/btg/btg.env (default 3000), installs the Caddy unit and reloads it.
# Idempotent: safe to rerun after a hostname or port change.
set -euo pipefail

ENV_FILE="${ENV_FILE:-/etc/btg/btg.env}"
CADDYFILE="${CADDYFILE:-/etc/caddy/Caddyfile}"
HOST="${1:-}"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
template="$here/Caddyfile.tmpl"

die() { echo "error: $*" >&2; exit 1; }
log() { echo "==> $*"; }
env_value() { grep -E "^$1=" "$ENV_FILE" | tail -n 1 | cut -d= -f2- | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/"; }

[ "$(id -u)" -eq 0 ] || die "run as root"
[ -n "$HOST" ] || die "usage: sudo deploy/setup-proxy.sh HOST"
[[ "$HOST" =~ ^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$ ]] || die "HOST must be a domain name"
[ -f "$template" ] || die "missing $template"
command -v systemctl >/dev/null || die "systemctl not found in PATH"

PORT=3000
if [ -f "$ENV_FILE" ]; then
  value="$(env_value PORT)"
  [ -n "$value" ] && PORT="$value"
fi
[[ "$PORT" =~ ^[0-9]+$ ]] && [ "$PORT" -ge 1 ] && [ "$PORT" -le 65535 ] || die "PORT must be 1-65535"

install_caddy() {
  command -v apt-get >/dev/null || die "caddy is not installed and apt-get is unavailable"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl gnupg
  install -d -m 0755 /usr/share/keyrings /etc/apt/sources.list.d /etc/caddy
  key="$(mktemp)"
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o "$key"
  install -m 0644 "$key" /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  rm -f "$key"
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' -o /etc/apt/sources.list.d/caddy-stable.list
  apt-get update
  apt-get install -y caddy
}

if ! command -v caddy >/dev/null; then
  log "installing Caddy"
  install_caddy
fi
command -v caddy >/dev/null || die "caddy not found after install"

if ! systemctl cat caddy >/dev/null 2>&1; then
  log "installing the Caddy unit"
  if ! id caddy >/dev/null 2>&1; then
    useradd --system --home-dir /var/lib/caddy --create-home --shell /usr/sbin/nologin caddy
  fi
  install -d -m 0755 /etc/caddy
  cat >/etc/systemd/system/caddy.service <<'UNIT'
[Unit]
Description=Caddy
After=network-online.target
Wants=network-online.target

[Service]
Type=notify
User=caddy
Group=caddy
ExecStart=/usr/bin/caddy run --environ --config /etc/caddy/Caddyfile
ExecReload=/usr/bin/caddy reload --config /etc/caddy/Caddyfile --force
TimeoutStopSec=5s
LimitNOFILE=1048576
AmbientCapabilities=CAP_NET_BIND_SERVICE
CapabilityBoundingSet=CAP_NET_BIND_SERVICE
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
UNIT
  systemctl daemon-reload
fi

log "rendering $CADDYFILE for $HOST port $PORT"
rendered="$(mktemp)"
sed -e "s|\${HOST}|$HOST|g" -e "s|\${PORT}|$PORT|g" "$template" >"$rendered"
grep -q '\${HOST}\|\${PORT}' "$rendered" && die "template placeholders were not rendered"
caddy validate --adapter caddyfile --config "$rendered" >/dev/null
install -m 0644 "$rendered" "$CADDYFILE"
rm -f "$rendered"

systemctl enable caddy >/dev/null
if systemctl is-active --quiet caddy; then
  systemctl reload caddy
else
  systemctl restart caddy
fi
systemctl is-active --quiet caddy || die "caddy is not active; see journalctl -u caddy"
log "Caddy serves https://$HOST -> http://127.0.0.1:$PORT"
