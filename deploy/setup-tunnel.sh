#!/usr/bin/env bash
# usage: sudo HOST=app.example.com [TUNNEL_NAME=btg] [PORT=3000] deploy/setup-tunnel.sh
#        sudo deploy/setup-tunnel.sh app.example.com
# Creates a named Cloudflare Tunnel, routes HOST to it, renders /etc/cloudflared/config.yml and runs cloudflared as a systemd service.
# PORT must match PORT in /etc/btg/btg.env. Set APP_ORIGIN=https://HOST there too.
# Idempotent: every step is skipped when its result already exists.
set -euo pipefail

HOST="${1:-${HOST:-}}"
TUNNEL_NAME="${TUNNEL_NAME:-btg}"
PORT="${PORT:-3000}"
CF_DIR="${CF_DIR:-/etc/cloudflared}"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
template="$here/cloudflared/config.yml.tmpl"

die() { echo "error: $*" >&2; exit 1; }
log() { echo "==> $*"; }
tunnel_id() { cloudflared tunnel list --name "$TUNNEL_NAME" --output json | jq -r '.[0].id // empty'; }

[ -n "$HOST" ] || die "HOST is required (arg 1 or HOST env), e.g. app.example.com"
[[ "$HOST" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$ ]] || die "HOST is not a valid lowercase hostname: $HOST"
[[ "$TUNNEL_NAME" =~ ^[A-Za-z0-9-]+$ ]] || die "TUNNEL_NAME may contain only letters, digits and dashes"
[[ "$PORT" =~ ^[0-9]{1,5}$ ]] && [ "$PORT" -ge 1 ] && [ "$PORT" -le 65535 ] || die "PORT must be 1-65535"
[ "$(id -u)" -eq 0 ] || die "run as root (writes $CF_DIR and installs the service)"
for cmd in cloudflared jq envsubst systemctl; do
  command -v "$cmd" >/dev/null || die "$cmd not found in PATH"
done
[ -f "$template" ] || die "missing template $template"

mkdir -p "$CF_DIR"

if [ ! -f "$HOME/.cloudflared/cert.pem" ]; then
  log "cloudflared tunnel login (authorize the zone that contains $HOST)"
  cloudflared tunnel login
fi

ID="$(tunnel_id)"
if [ -z "$ID" ]; then
  log "creating tunnel $TUNNEL_NAME"
  cloudflared tunnel create "$TUNNEL_NAME"
  ID="$(tunnel_id)"
fi
[ -n "$ID" ] || die "tunnel $TUNNEL_NAME has no ID after create"

creds="$CF_DIR/$ID.json"
if [ ! -f "$creds" ]; then
  src="$HOME/.cloudflared/$ID.json"
  [ -f "$src" ] || die "credentials for $ID not found at $src; copy them from the machine that created the tunnel"
  install -m 0600 "$src" "$creds"
fi

log "routing $HOST to tunnel $TUNNEL_NAME"
if out="$(cloudflared tunnel route dns "$TUNNEL_NAME" "$HOST" 2>&1)"; then
  echo "$out"
elif grep -qi 'already exists' <<<"$out"; then
  echo "DNS route for $HOST already exists"
else
  echo "$out" >&2
  die "tunnel route dns failed"
fi

log "rendering $CF_DIR/config.yml"
tmp="$(mktemp "$CF_DIR/.config.XXXXXX")"
trap 'rm -f "$tmp"' EXIT
TUNNEL_ID="$ID" HOST="$HOST" PORT="$PORT" envsubst '${TUNNEL_ID} ${HOST} ${PORT}' <"$template" >"$tmp"
chmod 0644 "$tmp"
mv -f "$tmp" "$CF_DIR/config.yml"

cloudflared tunnel ingress validate --config "$CF_DIR/config.yml"

if ! systemctl cat cloudflared >/dev/null 2>&1; then
  log "installing cloudflared service"
  cloudflared service install
fi
systemctl enable cloudflared >/dev/null
systemctl restart cloudflared
systemctl is-active --quiet cloudflared || die "cloudflared is not active; see journalctl -u cloudflared"

log "tunnel $TUNNEL_NAME ($ID) serves https://$HOST -> http://127.0.0.1:$PORT"
