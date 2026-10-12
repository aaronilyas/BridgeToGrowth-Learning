# Existing Cloudflare Tunnel

This deployment reuses the existing host connector, domain
`bridgetogrowth-learning.com`, and origin `http://127.0.0.1:8000`.
The public API origin is `https://bridgetogrowth-learning.com`. No `api.*`
hostname, new tunnel, DNS record, connector login, credential rotation or Docker
connector is required. The root `.env` is the single backend configuration source.

## Operator prerequisites for external mode

Keep the backend stopped on port 8000 while reviewing the route. Set:

```dotenv
CLOUDFLARE_ENABLED=true
CLOUDFLARE_TUNNEL_MODE=external
CLOUDFLARE_HOSTNAME=bridgetogrowth-learning.com
CLOUDFLARE_TUNNEL_ID=<existing tunnel UUID>
CLOUDFLARE_ACCOUNT_ID=<account ID>
CLOUDFLARE_ZONE_ID=<zone ID>
CLOUDFLARE_API_TOKEN=<scoped read-only API token>
API_PORT=8000
LOCAL_API_PORT=18000
```

External mode needs inspection access, **not provisioning/connector credentials**.
Create a scoped user API token with Account Cloudflare Tunnel Read, Account
Rulesets Read, Workers Scripts Read (for Worker custom domains), and Zone Read,
DNS Read, Zone Settings Read, Page Rules Read, Workers Routes Read and Cache
Rules Read (permission names can appear as Cache Settings Read). Scope it to
this account/zone. Missing/denied inspections fail readiness before starting the
origin. Token verification alone does not establish these permissions.
The operator makes GET requests only in external mode and never fetches a
connector token or adopts remote resources.

For a remotely configured existing tunnel, the loaded ingress must be exactly
these two rules (use the `path` verbatim from
[deployment/cloudflare.py](deployment/cloudflare.py), or the reference below):

```yaml
ingress:
  - hostname: bridgetogrowth-learning.com
    path: '^/(auth/(signup|verify|login|refresh|logout|logout-all|recovery|reset|resend|enrollment|enrollment/verify)/?|account(/phone(/verify)?|/delete)?/?|lessons/?|lessons/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}(/cancel)?/?)$'
    service: http://127.0.0.1:8000
  - service: http_status:404
```

Operator action, if this differs: edit only the existing tunnel's ingress under
its established owner's control, preserve its origin/DNS/credentials, restrict
the path, and retain the final 404. Review any shared routes rather than removing
unrelated routes automatically. No global/per-route origin overrides are accepted.
All connected replicas must report the current configuration version before
port 8000 opens. An offline or stale external connector fails readiness; its
owner must inspect its logs and restore connectivity. Startup never launches a
replacement connector. A locally configured connector cannot be verified through
the remote configurations API; automatic production startup fails clearly.
Its owner must validate the actual loaded local ingress against
[config.example.yml](deploy/cloudflare/config.example.yml) and establish a
reviewable verification method; private staging remains available. Do not switch
connector ownership or migrate it merely to bypass this failure.

Only auth, account (including `POST /account/delete`), lesson submission/status
and cancellation paths reach FastAPI. `/internal/receipts`, `/video`,
`/verification`, `/docs`, `/redoc`, `/openapi.json`, `/healthz`, Docker and renderer
interfaces stay private. No public provider webhook is needed.

## Cache and routing policy

Create one enabled Cache Rule with expression
`(http.host eq "bridgetogrowth-learning.com")`, action `set_cache_settings`, and
parameters `{"cache":false}`. Operator action: review/remove or explicitly exclude
this hostname from conflicting Page Rules, Worker routes/custom domains, cache
eligibility/TTL overrides, account cache policies, cache response rules,
header/URL transformations, origin rules, redirects and snippets. Do not edit
unrelated policies. The automated inspector intentionally fails on policies whose
expressions it cannot prove safe (only simple `http.host eq`/`ne` or
`not (http.host eq ...)` exclusions are recognized); it does not claim arbitrary edge rules are safe.
Page Rule/Worker matching considers the entire hostname regardless of path,
including `/auth`, `/lessons`, `/account/delete`, private paths and query patterns.

FastAPI sends `Cache-Control: no-store` on all responses. Public readiness also
requires unauthenticated account/lesson responses to be 401, `no-store`,
`CF-Cache-Status: DYNAMIC` or `BYPASS`, and no `Age`; private-route probes must be
404. These probes supplement configuration evidence and do not prove every
possible request is safe. Remote changes after verification require another
operator review/startup. Maintain change control on this hostname's policies.

API behavior was checked against current official documentation:
[ordered ingress, regex paths and catch-all](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/local-management/configuration-file/),
[cache action and phase](https://developers.cloudflare.com/cache/how-to/cache-rules/create-api/),
[Worker routes](https://developers.cloudflare.com/api/resources/workers/subresources/routes/methods/list/),
[tunnel configurations](https://developers.cloudflare.com/api/resources/zero_trust/subresources/tunnels/subresources/cloudflared/subresources/configurations/methods/get/),
[connector config versions](https://developers.cloudflare.com/api/resources/zero_trust/subresources/tunnels/subresources/cloudflared/subresources/connections/methods/get/).
Whole-ruleset replacement can delete unrelated rules; this operator never does it.

## Start, stop and private staging

```sh
./start-backend.sh
./stop-backend.sh
# After stopping the public backend, private staging on LOCAL_API_PORT:
./start-backend.sh --local-only
./stop-backend.sh
```

Local service health, public HTTPS readiness and external connector status are
reported separately. Backend shutdown leaves the external connector running;
it does not claim to stop it. `--local-only` and `CLOUDFLARE_ENABLED=false` select
loopback port 18000 by default, **never 8000**. The existing port-8000 route cannot
reach that backend. Reserve the staging port for local use: do not configure
another tunnel/proxy/port forward to it. Stop before switching modes; running
port/configuration mismatches fail instead of silently keeping the public origin.
A host administrator can always change forwarding, so this is isolation from the
specified existing route, not protection against the host administrator.

## Optional managed mode for other deployments

`CLOUDFLARE_TUNNEL_MODE=managed` retains the existing owned remote-tunnel/DNS/cache
provisioner and Compose connector. **Do not use it for this existing host route.**
It requires Tunnel Edit, DNS Edit, Cache Rules Edit plus the inspection permissions
above. First provisioning requires unused tunnel name and DNS hostname; resources
are never adopted without saved ownership IDs. Apex hostnames are supported, but
an existing apex record is a conflict. Repeated startup checks saved identity and
configuration and reuses owned remote resources. Only the owned hostname cache
rule is appended; unrelated rules are not replaced. Lost creation responses or
ownership conflicts require operator review/restoration, not blind retries.
`.local/backend` is mode 0700; saved state, normalized Compose configuration and
connector-token files are atomically written as 0600. Managed stop preserves
remote tunnel, DNS, tokens and persistent volumes.
