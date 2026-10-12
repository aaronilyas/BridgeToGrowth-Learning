# Automated backend and messaging verification

Requirements come from [product-overview.md](../../product-overview.md), with
architectural constraints in [agents.md](../../agents.md). The semantic scenarios
in [acceptance.feature](acceptance.feature) are supplemented by executable tests
for the completed account/security/lifecycle behavior. See the precise
[account](../AUTHENTICATION.md) and [lesson](../README.md) contracts.

## Required acceptance run

Install Python dependencies, Docker/Compose and `cloudflared`. Build all current
images on the test daemon. No credential env file is needed:

```sh
python3 -m venv .venv
.venv/bin/pip install -r backend/requirements.txt -r backend/tests/requirements.txt
docker build -f backend/container/Dockerfile -t btg-renderer:acceptance .
docker build -f deployment/egress/Dockerfile -t btg-egress:local .
docker build -f deployment/coordinator.Dockerfile -t btg-acceptance-coordinator .
docker build -f deployment/messaging.Dockerfile -t btg-acceptance-messaging .
USER_CONTAINER_IMAGE=btg-renderer:acceptance RENDERER_EGRESS_IMAGE=btg-egress:local .venv/bin/python -m backend.tests.run_acceptance
```

The runner creates a unique disposable PostgreSQL 17 container with tmpfs data
and a random loopback port, ignoring external database URLs. It checks the fresh
SQL schema before ORM fixtures reset tables, then runs ALL tests including both
migration paths, real PostgreSQL transactions/constraints/coordinator guard,
real Manim/voiceover containers, trusted egress proxies and Cloudflare rule checks.
Required skips make the run fail. No live migration, DNS change, provider call or
real message occurs. Generated and hostile executable fixtures run only inside
restricted user containers; host tests never execute their generated Python.
Disposable test containers/networks are removed after their work has stopped.

For faster deterministic checks:

```sh
.venv/bin/python -m unittest discover -s backend/tests -v
npm --prefix services/messaging ci
npm --prefix services/messaging run typecheck
npm --prefix services/messaging run build
npm --prefix services/messaging test
```

Default Python tests use SQLite and explicitly skip PostgreSQL/architecture
checks, so they do not replace required acceptance. `TEST_DATABASE_URL` enables
PostgreSQL fixtures that DROP AND RECREATE TABLES; never point it at real data.
The acceptance runner always creates its own database instead. Node tests use
the installed text/attachment builders, local HTTP handlers and transport
substitutes. They need neither Photon credentials nor a provider connection.

## Coverage

| Test module | Automated evidence |
| --- | --- |
| `test_auth.py` | Real Argon2id signup/verification/login; opaque-token expiry, rotation/reuse, logout/all, recovery/reset, phone changes, persisted throttles, cooldowns/attempts/expiry/replays, existence-neutral responses, legacy enrollment, stale security challenges, authenticated activity and secret redaction |
| `test_backend.py` | Scope/render limits, owner/recipient derivation, independent evaluation, voiceover checks, stage failures, activity/cleanup admission protection and PostgreSQL single-coordinator guard |
| `test_job_security.py` | Cancellation at scope/generation/render/evaluation/send boundaries, queued ownership, concurrent account-scoped idempotency, durable cleanup/recovery, active-process preservation, acceptance uncertainty, signed/forged/duplicate/out-of-order/early receipts and evaluation metadata |
| `test_delivery_semantics.py` | Atomic job/message acceptance, failed commit, uncertain send without retry, no fabricated delivered status and the original acceptance migration |
| `test_migration.py` | Exact 001→002 upgrade preserves UUIDs/relationships, creates no credentials/sessions/verification, leaves historical recipient unknown and records interrupted cleanup |
| `test_architecture.py` | Real restricted Manim/voiceover, Node HTTP with substituted SDK acceptance, process/PID/file/network/capability isolation, hostile escape rejection, enforced direct/proxy egress denial, real cancellation, startup process reconciliation and temporary cleanup |
| `test_voiceover_worker.py` / `test_voiceover_container.py` | Trusted duration/audio validation with substitutes and real silent/audio-stream Manim renders in network-disabled containers |
| `test_deployment.py` | Credential-free Compose expansion, private sockets/ports/build contexts, real loopback API startup and public/private Cloudflare ingress matching |
| Node `delivery.test.ts`, `verification.test.ts`, `receipts.test.ts` | Bounded uploads/JSON, authorization, installed SDK attachment/text contract, rejected/no-op/missing IDs, read-event filtering/HMAC and durable receipt retry |

Real audio-stream fixtures intentionally use synthetic silence/offline speech.
They prove structure/wiring, never real intelligibility, accuracy, timing or
Gemini evaluation quality. Offline Gemini and Photon substitutes verify contracts
and observable failure behavior, not live service performance. No production
verification bypass is used: account tests verify the actual stored code hash
using codes captured ONLY by injected test transport.

Live Gemini/GTTS/Photon and complete frontend-to-backend testing are deferred
until the frontend is ready. The [later checklist](../README.md#verification-and-later-integration)
includes actual phone onboarding, mobile secure token storage, provider quota and
read-receipt availability, production proxy connectivity, DNS/TLS and controlled
crash tests in the final deployed topology. Missing read receipts must remain
unconfirmed; acceptance never proves receipt.


## Deployment and account-lifecycle additions

`test_deployment_operator.py` uses synthetic env, disposable state and injectable
Docker/Cloudflare transports. It covers external read-only mode, owned managed
provision/reuse, apex hostname, cache/Page Rule/Worker conflicts across all paths,
connector config convergence, permission failure, no-origin-before-prerequisites,
private-port staging, ownership/mode conflicts, token file modes/redaction and
indefinite ordered/repeated stops with preserved data.
`test_account_lifecycle.py` covers rolling admission windows, accurate Retry-After,
matching idempotency without new dispatch, atomic cross-account capacity, failed
cleanup, deletion credentials/retries/revocation, active drain/queued cancellation,
busy interrupted recovery, removal failure/restart, late receipts/other-account
isolation and Python receipt expiry. Node tests verify spool expiry at seven days.
The exact 003 deletion migration is included in the PostgreSQL upgrade fixture.

After building the current acceptance images above, run the disposable private
operator exercise (no Cloudflare, Gemini or Photon access):

```sh
.venv/bin/python -m backend.tests.run_local_lifecycle
```

It uses a temporary checkout, unique Compose project, a free loopback staging
port, real PostgreSQL/ASGI/Node services and explicit provider/runtime substitutes.
It verifies start, running reuse, active-work drain before dependency shutdown,
repeated stop and restart, retained account,
session/job evidence, a synthetic receipt-spool marker and both persistent volumes. It excludes the host Docker
socket. Builds are substituted with already-built acceptance images. Only its
unique disposable project/volumes are removed after graceful stop; production
operator stop never deletes volumes. This exercise supplements the actual renderer
isolation tests in `run_acceptance`, which require Docker and cloudflared.


The 2026-10-12 audit of the existing Photon SDK dependency chain reports 14 moderate npm audit
findings through vulnerable OpenTelemetry Core baggage propagation. `npm audit
--omit=dev` fails for these advisories; typechecking/tests/build do not resolve
advisories. The suggested force fix includes a Spectrum downgrade incompatible
with the installed 12.x API. Review a compatible upstream Photon telemetry upgrade
or a separately tested dependency override; this work retains the existing SDK
architecture and does not apply that breaking downgrade.
