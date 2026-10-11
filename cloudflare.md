# Standalone Cloudflare Tunnel

Run a locally managed named tunnel with a host-installed `cloudflared`. This
setup works independently of Docker Compose and forwards only the existing API
paths to an operator-selected origin. It does not start the API or its services.

## Prerequisites and private origin

Install `cloudflared` using Cloudflare's
[installation guide](https://developers.cloudflare.com/tunnel/features/locally-managed-tunnels/create-local-tunnel/).
On macOS, `brew install cloudflared` is sufficient. Use a Cloudflare account
with a DNS zone you control and permission to create a tunnel and DNS record.

Start the backend according to [backend/README.md](backend/README.md), including
its environment settings. For a host API, explicitly bind to loopback:

```sh
.venv/bin/uvicorn backend.main:app --host 127.0.0.1 --port 8000 --workers 1
```

Choose `API_ORIGIN` relative to the machine running `cloudflared`: for that
example it is `http://127.0.0.1:8000`. A different port or an HTTPS origin is
supported. Use a base HTTP(S) URL with no path, query, or embedded credentials,
pointing directly to FastAPI rather than a proxy that also serves private
services. HTTPS origins need a certificate trusted by the connector; keep TLS
verification enabled. If the API is already containerized, provide a reachable
private origin, such as a port published only on the connector host's loopback.
No Compose service names, files, or networks are assumed here.

Do not publish PostgreSQL, the Node messaging service, Docker control ports, or
renderer ports publicly. Keep their listeners on loopback or a private network
with firewall rules restricting callers. Do not give the connector a Docker
socket, user-container files, or renderer mounts. The tunnel's route restriction
does not secure ports independently exposed by the host. The existing backend
continues to own authentication, isolated rendering, temporary video cleanup,
and the 25-minute idle-container policy.

## Provision and configure

Run these commands as the operator who owns the Cloudflare zone, replacing
`<TUNNEL_NAME>` with your chosen name:

```sh
cloudflared tunnel login
cloudflared tunnel create '<TUNNEL_NAME>'
```

Keep the returned UUID and JSON credentials path. Login creates an account
management certificate (`cert.pem`); the connector runtime needs the tunnel's
JSON credentials, not that account certificate. Keep both outside the checkout
and restrict access to their owner. Never commit them or copy them into user
containers.

From this worktree's root, copy the template to a dedicated local configuration:

```sh
mkdir -p "$HOME/.cloudflared"
chmod 700 "$HOME/.cloudflared"
cp deploy/cloudflare/config.example.yml "$HOME/.cloudflared/btg-api.yml"
chmod 600 "$HOME/.cloudflared/btg-api.yml"
```

Edit `btg-api.yml` and replace these literal placeholders. YAML does not expand
shell variables here, so the credentials path must be absolute, with no `~`.

- `<TUNNEL_UUID>`: UUID returned when creating your tunnel.
- `<ABSOLUTE_TUNNEL_CREDENTIALS_JSON_PATH>`: path to that tunnel's JSON file.
- `<PUBLIC_API_HOSTNAME>`: chosen hostname in your zone, without a scheme or path.
- `<API_ORIGIN>`: reachable private API base URL described above.

Restrict the credentials file to its owner with `chmod 600`. The template exposes the documented `/auth/*` endpoints, `/account`,
`/account/phone`, `/account/phone/verify`, `/lessons`, `/lessons/<UUID>` and
`/lessons/<UUID>/cancel` (also with trailing slashes).
All other paths and hostnames return 404, including `/video`, `/verification`, `/internal/receipts`, `/docs`, `/redoc`,
and `/openapi.json`. HTTP methods and bearer-session validation remain the API's
responsibility. Path matching does not grant authorization.

## Validate, route DNS, and start

Validate the edited file before provisioning DNS:

```sh
cloudflared tunnel --config "$HOME/.cloudflared/btg-api.yml" ingress validate
cloudflared tunnel --config "$HOME/.cloudflared/btg-api.yml" ingress rule 'https://<PUBLIC_API_HOSTNAME>/lessons'
cloudflared tunnel --config "$HOME/.cloudflared/btg-api.yml" ingress rule 'https://<PUBLIC_API_HOSTNAME>/video'
```

After replacing the hostname in those commands, `/lessons` must select rule 0
and `/video` must select the final 404 rule. Check `/docs` and a different
hostname as well. These commands check configuration only, without connecting
to Cloudflare or requiring a running API.

Create the DNS route and start the foreground connector:

```sh
cloudflared tunnel route dns '<TUNNEL_UUID>' '<PUBLIC_API_HOSTNAME>'
sh deploy/cloudflare/start.sh "$HOME/.cloudflared/btg-api.yml"
```

The script validates ingress and then runs the named tunnel. It accepts an
absolute configuration path and requires no additional packages. Use Ctrl-C to
stop only the connector; backend jobs and user containers continue normally.
For unattended operation, supervise this same command as a dedicated user with
read access to its configuration and tunnel credentials. Metrics bind only to
`127.0.0.1:20241`; choose another loopback port if occupied.

## Verify and troubleshoot

From a separate machine, with your configured hostname:

```sh
curl -i 'https://<PUBLIC_API_HOSTNAME>/lessons/00000000-0000-0000-0000-000000000000'
curl -i 'https://<PUBLIC_API_HOSTNAME>/video'
curl -i 'https://<PUBLIC_API_HOSTNAME>/docs'
```

The first request should be rejected by API authentication (currently HTTP 401);
the others should return the tunnel's 404. Use the backend signup/verification/login flow to obtain an access bearer for
account retrieval and lesson polling. Full mobile integration is deferred until
the frontend is ready; see [mobile token expectations](backend/AUTHENTICATION.md). Do not put real
tokens in committed examples. Configure Cloudflare cache rules to bypass
caching for this API hostname, so user-specific status responses stay private.
Cloudflare Access, if desired, needs a separately agreed mobile authentication
flow; no Access policy or production hostname is assumed by this setup.

For a 502, check origin reachability from the connector host and the configured
scheme/port. For an unavailable tunnel, check the connector process, credentials,
and DNS route. Ensure outbound connector traffic is allowed per Cloudflare's
network requirements; no inbound forwarding to service ports is needed.

Cloudflare's [configuration reference](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/local-management/configuration-file/)
documents ordered ingress rules, path matching, and the final catch-all.
Live DNS, credentials, firewall policy, and the final deployment topology must
be supplied by the operator before an end-to-end connectivity check.

## Compose origin

For [the Compose stack](compose.md), run `cloudflared` directly on the Docker
host and set `<API_ORIGIN>` to `http://127.0.0.1:8000` (or the selected `API_PORT`).
Compose publishes only this loopback coordinator port. PostgreSQL and messaging
have no published ports; Docker control is a private Unix socket mounted only
in the coordinator. Use the template's path allowlist and 404 fallback. Do not
run the connector in a normal bridge container pointed at `127.0.0.1`: that
address would refer to the connector container itself.

`backend/tests/run_acceptance.py` verifies these rules with synthetic config
and a real disposable coordinator bound to loopback; no tunnel or DNS is created.

The receipt consumer uses the authenticated Spectrum cloud stream and a private
Node-to-coordinator HMAC callback. No provider callback needs public exposure.
Never broaden the tunnel allowlist to `/internal/receipts` or Node verification
transport. Auth and account routes must bypass Cloudflare caching.
