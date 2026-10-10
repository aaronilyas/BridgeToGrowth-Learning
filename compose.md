# Compose deployment

Run from the repository root on a Docker host with Docker Compose v2 or newer.
This stack runs PostgreSQL 17, exactly one FastAPI coordinator, and the existing
Node.js/TypeScript Photon service. An external identity provider and working Gemini
and Photon credentials are prerequisites; Compose does not implement signup or
phone verification. See [backend/README.md](backend/README.md) for the identity
provider contract and [services/messaging/README.md](services/messaging/README.md)
for delivery semantics.

## Configure and start

```sh
cp deployment/.env.example deployment/.env
chmod 600 deployment/.env
# Edit deployment/.env and fill every blank. Use hex secrets for the database
# password and shared messaging token: openssl rand -hex 32
docker compose --env-file deployment/.env config --quiet

# Build the existing renderer on the daemon that will create user containers.
# This image is a template, not a long-running Compose renderer service.
docker build -f backend/container/Dockerfile -t btg-renderer:local .
docker compose --env-file deployment/.env build
docker compose --env-file deployment/.env up -d --wait
docker compose --env-file deployment/.env ps
```

If `USER_CONTAINER_IMAGE` is changed, build/tag the renderer with that exact
name. The coordinator uses the host daemon through the socket mounted at
`/var/run/docker.sock`. `DOCKER_SOCKET_PATH` is a bind source on that daemon's
host (or Docker Desktop VM), not necessarily the socket path used by your local
CLI. A missing socket fails rather than creating a directory. The Docker CLI
in the coordinator must be compatible with the host daemon's API.

PostgreSQL initializes a **fresh** named volume using
`backend/schema.sql`. Existing volumes are retained and initialization is not
repeated. Before starting this version against an original-schema volume, drain
and stop the coordinator, back up the database, and apply
`backend/migrations/001_delivery_acceptance.sql` once with PostgreSQL
`ON_ERROR_STOP=1`. See [migration requirements](backend/README.md#delivery-status-and-existing-databases).
Never apply the migration to an already initialized fresh schema. Validation
uses a new tmpfs database and never migrates a live volume.
Changing `POSTGRES_PASSWORD` does not change credentials in an existing database;
rotate the database credential and deployment setting together. Do not delete
the volume to rotate credentials.

The API binds to `127.0.0.1:8000` (override `API_PORT`); database and messaging
ports are not published. Run [cloudflared on this Docker host](cloudflare.md#compose-origin) so its origin
`http://127.0.0.1:8000` reaches the published loopback API. A connector running
in a normal bridge container cannot reach that host loopback address. Database
traffic uses an internal Compose network; messaging and the coordinator have
outbound connectivity for Photon, identity, and Gemini calls.

## Contract and verification

The coordinator calls `http://messaging:3001/video` with raw MP4 bytes, its shared
bearer token, `X-Lesson-Job`, and `X-Recipient`. Messaging binds to `0.0.0.0:3001`
and uses emitted JavaScript built from TypeScript with `package-lock.json`. The
image installs production dependencies using `npm ci --omit=dev` and starts
`node dist/index.js`. Its 12 MiB
upload limit matches the backend's maximum evaluated video size. Videos remain
in memory during delivery; acceptance is Photon acceptance, not a receipt.

Health checks use PostgreSQL's readiness probe, an unauthenticated `POST /video`
that must return 401, and FastAPI's existing `/openapi.json`. The latter two
checks do not send messages or refresh authenticated user activity. They check
local service availability; they do not verify external credentials, Gemini
quality, or actual Photon delivery.

After starting, check `http://127.0.0.1:8000/docs`. With a real verified identity,
follow the existing authenticated `PUT /account`, `POST /lessons`, and
`GET /lessons/{id}` flow. Real delivery sends a message; use an intended test
recipient. Follow [backend/tests/README.md](backend/tests/README.md) for renderer
and isolation acceptance checks. Configuration validation and image builds alone
cannot prove the real integrations work.

## Isolation and lifecycle

Only the coordinator image includes Docker CLI and only the coordinator has
the Docker socket mount. Socket access grants control of the host daemon; use a
dedicated deployment daemon. PostgreSQL and messaging have no Docker control
access. Coordinator and messaging have read-only filesystems, dropped Linux
capabilities, no privilege escalation, and temporary `/tmp` mounts. Messaging
runs as Node's unprivileged UID 1000. Narrow Dockerfile-specific build contexts exclude
local `.env` files and only include the sources each image needs.

User render containers are created dynamically by the existing `DockerRuntime`,
outside Compose. They retain separate per-user networks, unprivileged UID,
read-only roots, tmpfs `/work` and `/tmp`, resource limits, no host mounts, and no
Docker socket. Gemini-generated Manim code runs only inside those containers.
The PostgreSQL volume stores accounts, progress, and delivery metadata; no
persistent volume stores generated videos. Each completed job cleans temporary
artifacts, and stopping a user container discards its tmpfs files.

The coordinator command explicitly uses one Uvicorn worker. Do not scale the
coordinator or run another stack against the same daemon: user-container names
are shared on that daemon. The existing database advisory lock also rejects a
second coordinator using the same database. No reload process, extra worker,
scheduler, or queue is added.

The application checks inactivity every 30 seconds and stops user containers
after 25 minutes without authenticated requests. Reserved jobs, persisted
nonterminal jobs, and pending cleanup protect a container from stopping.
Compose does not add a competing container reaper or automatic restart policy.

## Shutdown and interrupted work

Before updating or stopping the stack, stop admitting new lesson requests and
let current jobs finish. Keep PostgreSQL and messaging running while the
coordinator drains. Uvicorn waits for its background work; messaging finishes
active requests on SIGTERM. The 30-minute Docker grace periods are finite and
can eventually force termination, so operators must verify jobs and cleanup
have drained before stopping. Do not force-stop or remove active user containers.

Once drained, stop the coordinator first, then its dependencies:

```sh
docker compose --env-file deployment/.env stop coordinator
docker compose --env-file deployment/.env stop messaging postgres
```

Compose stop/down does not manage dynamically created user containers. Leave
the coordinator running for normal inactivity cleanup when that is needed.
Do not use `down -v` for routine maintenance: it deletes account/progress data.

Abrupt loss has no automatic job resume or safe delivery retry. Before manually
restarting after a crash, follow the existing backend reconciliation requirement:
confirm interrupted work has stopped, clean only that user's temporary artifacts,
and mark interrupted jobs failed. Persisted nonterminal jobs continue to protect
user containers; pending cleanup state is in memory and requires operator review
after process loss. A delivery timeout can occur after Photon acceptance, so
retrying may duplicate a message. Recovery automation, identity-provider choice,
production egress restrictions, and production tunnel DNS/credentials remain
operator or product decisions. The local tunnel topology is documented.
