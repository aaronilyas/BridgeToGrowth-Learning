# Backend deployment lifecycle

PostgreSQL 17, one FastAPI coordinator and the Node/TypeScript Photon transport
run in Compose. Generated Manim runs only in restricted per-account containers.
Use a dedicated Docker daemon. Keep the machine running continuously with reliable
internet and outbound Cloudflare/provider connectivity; sleep or internet loss
makes public access unavailable. See [Cloudflare prerequisites](cloudflare.md),
[account contracts](backend/AUTHENTICATION.md) and [tests](backend/tests/README.md).

## Configure the existing host tunnel

From this checkout:

```sh
cd /home/aaron/new-projects/BridgeToGrowth-Learning
# First setup only: never overwrite an existing configured .env.
test -e .env || cp .env.example .env
chmod 600 .env
# Edit .env locally. Generate three DISTINCT secrets and a URL-safe DB password:
openssl rand -hex 32
# Repeat independently for AUTH_CODE_SECRET, RECEIPT_SECRET, MESSAGING_TOKEN,
# and POSTGRES_PASSWORD. Supply Gemini and Photon project credentials locally.
# Set existing tunnel/account/zone IDs and a scoped READ token per cloudflare.md.
./start-backend.sh
./stop-backend.sh
```

Root `.env` is the only backend configuration source. `deployment/.env` is obsolete.
The operator parses literal values without shell evaluation and writes a private
normalized `.local/backend/compose.env`; that file is derived, not a second source.
Inherited shell values cannot override configured keys. Protect `.env` as 0600.
Do not publish full `docker compose config`, container environments or secret files.

Default `CLOUDFLARE_TUNNEL_MODE=external` reuses the existing host-managed connector
and `https://bridgetogrowth-learning.com` → `http://127.0.0.1:8000`. Startup verifies
public ingress/cache/DNS/connector configuration **before** exposing port 8000.
No tunnel/DNS/connector credential mutation occurs in this mode. Missing or
ambiguous evidence fails production readiness and gives an operator action.
`--local-only` or `CLOUDFLARE_ENABLED=false` uses `127.0.0.1:18000` (configurable
`LOCAL_API_PORT`, never 8000); reserve that port without any forwarding route.
Stop before changing modes/configuration. A pre-existing unowned Compose project
is never adopted: restore this checkout's ownership state or drain/migrate the
legacy deployment under its owner's control first.

Startup builds images, checks Docker/Compose, validates configuration, starts
PostgreSQL/messaging, runs a **read-only** schema compatibility check, then starts
one coordinator. It never automatically migrates an existing database. Running
owned services with matching configuration are reused without recreation; stop
then start to apply newly built images. `DOCKER_SOCKET_PATH` must be the real
daemon-side Unix socket; bind creation is disabled. No Docker TCP listener is used.
Only FastAPI has a host port; PostgreSQL, messaging and renderer/egress interfaces
have none. The coordinator alone receives the Docker socket. No proxy headers
are trusted (`--no-proxy-headers`); authentication IP throttles share the connector
address. Do not enable blanket forwarded-header trust.

## Database initialization and missing migrations

Fresh volumes initialize once from `backend/schema.sql`; do not run upgrades on
the current fresh schema. Existing volumes retain passwords and tables across
stop/start. Changing `.env` does not rotate an existing PostgreSQL role password.
Back up first, stop the coordinator with the operator, and start **only PostgreSQL**
for offline maintenance. Use the saved normalized config after a startup attempt:

```sh
./stop-backend.sh
docker compose --env-file .local/backend/compose.env -f compose.yaml up -d --no-deps --wait postgres
mkdir -p backups
chmod 700 backups
umask 077
docker compose --env-file .local/backend/compose.env -f compose.yaml exec -T postgres pg_dump -U btg -d btg -Fc > backups/btg-before-upgrade.dump
# Inspect columns/constraints against schema and keep an operator migration ledger.
docker compose --env-file .local/backend/compose.env -f compose.yaml exec -T postgres psql -U btg -d btg -c '\d users'
# Execute ONLY missing migrations, in order; each uses an explicit transaction.
docker compose --env-file .local/backend/compose.env -f compose.yaml exec -T postgres psql -U btg -d btg -v ON_ERROR_STOP=1 < backend/migrations/001_delivery_acceptance.sql
docker compose --env-file .local/backend/compose.env -f compose.yaml exec -T postgres psql -U btg -d btg -v ON_ERROR_STOP=1 < backend/migrations/002_owned_auth_and_recovery.sql
docker compose --env-file .local/backend/compose.env -f compose.yaml exec -T postgres psql -U btg -d btg -v ON_ERROR_STOP=1 < backend/migrations/003_account_deletion.sql
./stop-backend.sh
./start-backend.sh
```

These are manual operator commands, never implementation/test actions on live data.
A database already at 002 needs **only 003**, which adds
`users.deletion_requested_at`; a database at 001 needs 002 then 003. Compare
columns/constraints and the migration ledger to determine prior application; these
SQL files intentionally fail on repeated application. Test the dump restore on an
isolated database before relying on it. `backend.check_schema` checks required
columns read-only and reports incompatibility; it is not a complete migration ledger.
Legacy UUIDs/relationships remain; unverified legacy users need explicit enrollment
invitations as documented in [AUTHENTICATION.md](backend/AUTHENTICATION.md).
Drain/remove old unrestricted renderer containers under their original owner's
control before new work; no active user container may be force-removed.

## Backup, restore and credential rotation

Back up PostgreSQL using `pg_dump -Fc` after coordinator drain. Restore first to a
new isolated database using `pg_restore --exit-on-error`; verify schema, accounts
and lifecycle records there. For an intentional live restore, keep coordinator and
messaging stopped, have a rollback dump, and apply the reviewed dump to the selected
database using `pg_restore -U btg -d btg --exit-on-error` (a nonempty target needs an
explicit operator replacement plan). Never restore older rows and immediately
serve them: an older backup can restore deleted accounts or expired sessions.
Reapply recorded deletions/revocations before restarting.

Back up receipt-metadata separately while messaging is stopped; it contains only
read-event JSON, temporary files and quarantined evidence. Protect backups and
`.local/backend/state.json` as secrets; managed deployments also need their saved
connector token. Keep ownership state with its original checkout path and deployment
ID. Define and enforce a backup expiry schedule: **the application does not expire
or rewrite backups**. Recommended operator policy is 30 days, with deletion requests
recorded outside restored snapshots so removal can be reapplied. Provider message
retention remains under Photon/iMessage policy, outside this application.

Drain before credential changes. Rotate PostgreSQL with interactive `psql` `\password
btg`, then update root `.env` together; do not pass passwords on a command line.
Generate independent replacement application secrets locally; update account/receipt/
messaging configuration together as needed and stop/start. Rotating `AUTH_CODE_SECRET`
invalidates outstanding code hashes and changes throttle-key derivation; it does
not revoke stored opaque sessions, so revoke sessions explicitly if required.
Rotate Photon/Gemini/inspection credentials in their provider dashboards, update
root `.env`, and restart. External tunnel connector credentials remain owned by its
host administrator; backend rotation/shutdown never rotates them.

## Status, logs, shutdown and interrupted starts

```sh
docker compose --env-file .local/backend/compose.env -f compose.yaml ps
docker compose --env-file .local/backend/compose.env -f compose.yaml logs --tail=100 coordinator messaging postgres
./stop-backend.sh
```

Treat logs as sensitive; trusted bounded renderer stderr diagnostics reside in
coordinator tmpfs and disappear on recreation. No generated videos are persisted.
Local `/healthz` checks database reachability; private Node `/video` 401 and
PostgreSQL TCP checks establish local services, not provider credential validity.
Public HTTPS readiness includes auth/no-store/edge status and private-route 404
checks. External connector status comes from read-only Cloudflare evidence and is
reported independently; it is unknown during private staging/shutdown.

Stop order is any **owned** Compose connector, coordinator, messaging, PostgreSQL.
The coordinator drains work, including recovered active renderers and required cleanup,
before dependencies stop. Runtime observation/cleanup failures can keep stop waiting;
restore the dependency/ownership issue instead of imposing a kill timeout. Operator Docker stops use
`--time=-1` and no subprocess timeout: active work has no force-kill deadline.
Avoid direct `docker compose stop/down` on active services: finite Compose grace
periods do not provide this guarantee. Repeated stops are safe. Stop never removes
persistent volumes, receipt metadata, remote tunnel, DNS or credentials, and never
kills or claims to stop the existing host connector. Dynamic renderer resources
remain governed by coordinator activity/cleanup and durable account deletion.

On partial startup/error, owned services may remain; the CLI attempts to drain
owned ingress/coordinator on failure. External connector remains untouched. Run
`./stop-backend.sh`, correct the reported prerequisite, then restart. Preserve
`.local/backend` and volumes; do not delete ownership state to get past conflicts.
An interrupted remote creation with lost IDs requires operator inspection and
state recovery, not creation of duplicates. On coordinator restart, busy recovered
work remains protected; once idle, artifacts are cleaned and uncertain sends become
`delivery_unknown` without resend. Failed runtime cleanup/deletion remains durable
and retries on reconciliation/sweeps. Never use `down -v` on real data.

See [test instructions](backend/tests/README.md) for mocked Cloudflare/lifecycle
checks, disposable PostgreSQL/renderer acceptance and private restart exercises.
