# Compose deployment

The stack runs PostgreSQL 17, one FastAPI coordinator and the Node/TypeScript
Photon transport. Accounts and credentials belong to FastAPI. There is no
external identity-provider dependency. Read [backend/mobile contracts](backend/AUTHENTICATION.md),
[job behavior](backend/README.md), [renderer egress](deployment/egress/README.md)
and [messaging transport](services/messaging/README.md) before deployment.

## Configure and build

```sh
cp deployment/.env.example deployment/.env
chmod 600 deployment/.env
# Fill blanks locally. Generate a distinct value for each secret:
# openssl rand -hex 32
# Keep the PostgreSQL password URL-safe because Compose embeds it in DATABASE_URL.
docker compose --env-file deployment/.env config --quiet
docker build -f backend/container/Dockerfile -t btg-renderer:local .
docker build -f deployment/egress/Dockerfile -t btg-egress:local .
docker compose --env-file deployment/.env build
# Only start after completing any existing-volume upgrade below.
docker compose --env-file deployment/.env up -d --wait
docker compose --env-file deployment/.env ps
```

Set `AUTH_CODE_SECRET`, `RECEIPT_SECRET` and `MESSAGING_TOKEN` to distinct random
secrets of at least 32 characters. Also set database/Photon/Gemini settings from
the example. Startup fails with missing/invalid required settings. Build the
renderer and egress images on the same daemon used by the coordinator; changed
image tags must match `USER_CONTAINER_IMAGE` and `RENDERER_EGRESS_IMAGE`.
The coordinator alone receives the Docker socket and CLI. `DOCKER_SOCKET_PATH`
is a daemon-side bind path (including Docker Desktop's VM); a missing socket
fails rather than creating a directory. Use a dedicated deployment daemon.

PostgreSQL and messaging publish no ports. Only FastAPI publishes
`127.0.0.1:${API_PORT:-8000}`. Run host `cloudflared` with that loopback origin
and the [public auth/account/lesson allowlist](cloudflare.md). `/verification`,
`/video`, `/internal/receipts`, PostgreSQL and Docker control stay private.
`RECEIPT_URL=http://coordinator:8000/internal/receipts` is reachable only within
the trusted stack (and private loopback origin); it is HMAC-authenticated anyway.
The connector has no Docker socket. Configure trusted forwarded client addresses
only for the connector's actual source; default requests behind a proxy share
its address rate limit. Never set a blanket forwarded-address trust policy.

Compose's database network is internal. Its delivery network gives only the
coordinator and Node the required outbound access. Renderers do not join either.
They use per-account enforced proxy namespaces. Coordinator/Node filesystems
are read-only, with dropped capabilities and temporary `/tmp`. Node runs UID
1000. Narrow build contexts exclude credential `.env` files. The `receipt-metadata`
volume contains JSON read-event evidence only, never credentials, codes or videos;
the PostgreSQL volume stores account and lifecycle metadata only.

## Fresh databases and upgrades

New `postgres-data` volumes initialize from `backend/schema.sql` once. Do not
run upgrade SQL on a fresh current schema. Existing original volumes require
001 then 002; volumes already upgraded through 001 need only 002. Initialization
scripts do not upgrade existing volumes automatically.

Before upgrading, stop new admissions, drain existing jobs, keep dependencies
available during drain, stop the coordinator, and back up PostgreSQL. Then:

```sh
# Run only migrations not already applied, in order. Never ignore SQL errors.
docker compose --env-file deployment/.env exec -T postgres psql -U btg -d btg -v ON_ERROR_STOP=1 < backend/migrations/001_delivery_acceptance.sql
docker compose --env-file deployment/.env exec -T postgres psql -U btg -d btg -v ON_ERROR_STOP=1 < backend/migrations/002_owned_auth_and_recovery.sql
```

Existing account UUIDs/relationships survive, with null password and verification
columns. Issue enrollment invitations with `python -m backend.enroll <account-uuid>`
from an operator environment or `docker compose exec coordinator python -m
backend.enroll <account-uuid>` after startup, and hand stdout privately to the
verified original holder. See [safe enrollment](backend/AUTHENTICATION.md).
Duplicate historical provider IDs intentionally block the uniqueness migration
until ambiguous evidence is reviewed; never infer send-time phones or receipts.

Drain and stop/remove each old unrestricted `btg-user-<uuid>` container and its
old network before enrolling/starting new work. Preserve PostgreSQL. The new
runtime fails closed on a legacy network mode. Never delete a container with
active work. Updating image templates does not update already-created dynamic
containers: drain and recreate the affected renderer AND its egress helper.
Changing `POSTGRES_PASSWORD` in Compose does not rotate an existing database
credential; rotate that database role and configuration together. Do not use
`down -v` for updates because it deletes accounts and receipt evidence.

## Health, shutdown and recovery

Health checks use PostgreSQL TCP readiness, unauthenticated `/video` returning
401, and FastAPI `/openapi.json`. They send no message, consume no verification
code and refresh no account activity. They establish local service readiness,
with no claim about live provider credentials or narration quality.

Uvicorn uses exactly one worker and holds a PostgreSQL advisory guard. Do not
scale coordinators or share the deployment daemon with another BTG database.
The single coordinator atomically admits jobs and protects active work from
25-minute inactivity shutdown. Normal completion removes `/work` and `/tmp`
files; failed cleanup remains durable and protected.

For maintenance, stop admission at the public origin, let jobs and cleanup
finish, and stop coordinator before dependencies:

```sh
docker compose --env-file deployment/.env stop coordinator
docker compose --env-file deployment/.env stop messaging postgres
```

Graceful coordinator shutdown drains background tasks. Node drains active sends
before disconnecting Spectrum. Thirty-minute stop grace periods are finite;
verify drained work before stopping and never force-remove active user containers.
Dynamic containers are outside Compose's lifecycle. Leave the coordinator running
when normal inactivity cleanup is desired.

After an abrupt coordinator crash, startup reconciles actual owned container
processes, preserves active work, cleans abandoned artifacts after processes
stop, restores inactivity eligibility, and retries persisted cleanup obligations.
Committed acceptance is retained; uncertain sends become `delivery_unknown` and
are never resent automatically. Runtime/DB uncertainty keeps protection until
observations succeed. See [precise terminal outcomes](backend/README.md#status-meanings-and-cancellation).
The receipt spool survives Node/backend outages; signature timestamps are regenerated
on retry and accepted read evidence survives in PostgreSQL.

## Automated checks and deferred live work

Follow [tests/README.md](backend/tests/README.md) to run disposable PostgreSQL,
real restricted renderers, message substitutes and synthetic tunnel-rule tests.
The runner never migrates a production database, reads credential files or sends
real provider messages. Live Gemini/GTTS/Photon, production DNS/TLS and full mobile
integration are deferred until the frontend is ready; use the checklist in
[backend/README.md](backend/README.md#verification-and-later-integration).
