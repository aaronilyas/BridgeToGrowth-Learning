# P02 · Cloudflare Tunnel, edge config, service units

GOAL: `https://$HOST` reaches the local Bun process only through a Cloudflare Tunnel. The edge sets the security headers, rate-limits auth and adds visitor-location headers. No port is open to the internet.

GIVEN: P00 (`/api/health` works). The operator has a Cloudflare account and a zone for `$HOST`.

DELIVER:
- `deploy/cloudflared/config.yml.tmpl`: `tunnel: ${TUNNEL_ID}`, `credentials-file`. Ingress: `hostname: ${HOST} → service: http://127.0.0.1:3000`, then a catch-all `http_status:404`.
- `deploy/systemd/btg.service`: `User=btg`, `WorkingDirectory=/opt/btg`, `EnvironmentFile=/etc/btg/btg.env` (mode 0600, root), `ExecStart=<abs bun> dist/index.js`, `Restart=on-failure`, `NoNewPrivileges=yes`, `ProtectSystem=strict`, `ProtectHome=yes`, `PrivateTmp=yes`, `PrivateDevices=yes`, `CapabilityBoundingSet=`, `RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX`. Add a comment saying `MemoryDenyWriteExecute` must stay off because the JSC JIT needs it.
- `deploy/setup-tunnel.sh`: idempotent. Runs `cloudflared tunnel login` (if no cert exists), `tunnel create btg` (if missing), `tunnel route dns btg $HOST`, renders the template, `cloudflared service install`.
- `deploy/cloudflare-dashboard.md`: a checklist of dashboard settings, given as exact click-paths and values:
  - SSL/TLS: Always Use HTTPS on; HSTS max-age 15552000 with includeSubDomains; minimum TLS 1.2.
  - Rules › Managed Transforms: turn on **Add visitor location headers** (P11 needs `cf-iplatitude` and `cf-ipcountry`).
  - Rules › Response Header Transform (all requests), set these headers:
    - `Content-Security-Policy: default-src 'self'; script-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`
    - `X-Content-Type-Options: nosniff`
    - `Referrer-Policy: strict-origin-when-cross-origin`
    - `Permissions-Policy: camera=(), microphone=(), geolocation=()`
  - WAF › Rate limiting rules: `starts_with(http.request.uri.path, "/api/auth/")` → 10 requests/min per IP → block for 10 minutes.
  - Cache Rules: `/api/*` → bypass cache.
  - Turnstile: a managed widget for `$HOST`. Copy its site key and secret into `/etc/btg/btg.env`.
  - **Do not** enable Bot Fight Mode: it can't be bypassed on the free plan and blocks Stripe webhooks.
  - Stripe dashboard: webhook endpoint `https://$HOST/api/stripe/webhook`, with events `customer.subscription.created|updated|deleted`.

INV:
- The only inbound path is Cloudflare edge, then the tunnel, then `127.0.0.1:3000`. Postgres listens on localhost only.
- No secret appears in the repo. Templates use `${VAR}` placeholders only.

TESTS: none.

VERIFY:
- `cloudflared tunnel ingress validate --config /etc/cloudflared/config.yml` passes.
- `curl -sI https://$HOST/api/health` returns 200 and includes the `content-security-policy` and `strict-transport-security` headers.
- `ss -ltn` shows no `0.0.0.0` or `[::]` listener on 3000 or 5432.
- 11 rapid `POST https://$HOST/api/auth/login` requests: at least the last one gets a 429 from the edge.

NO: Terraform, Workers, R2, Docker, Cloudflare Access.
