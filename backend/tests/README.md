# FastAPI backend acceptance suite

This language-agnostic suite specifies the backend behavior required by
[agents.md](../../agents.md) and [product-overview.md](../../product-overview.md).
The Gherkin scenarios in [acceptance.feature](acceptance.feature) can be bound to
any test runner or executed as an acceptance checklist. They are specifications,
not directly runnable tests. The backend now implements three FastAPI routes
and job orchestration; `test_backend.py` exercises their contracts with deterministic
substitutes. See [backend setup](../README.md) for execution commands and the
external authentication/delivery contracts. Default substitute tests do not establish real container isolation or live
Photon integration. The opt-in executable architecture run below exercises
real containers and a real Node HTTP boundary with substituted Photon responses.

## Execution contract

The executable adapter binds registration to `PUT /account`, submission to
`POST /lessons`, and polling to `GET /lessons/{id}`. The Gherkin specifications
remain semantic requirements; the implemented contract is documented in the
backend README. Assert observable outcomes
and forbidden side effects. Existing model status names may guide an adapter,
but their presence alone does not establish product behavior.

Use two registered users (A and B), independent authenticated sessions, a
disposable PostgreSQL database, a controllable UTC clock, and deterministic
Gemini, renderer, evaluator, and Node delivery-service substitutes. Record
calls, execution location, recipient, artifact ownership, and lifecycle events.
Use small video fixtures whose measured durations are below, exactly at, and
above 90 seconds. Inject failures at each external boundary without contacting
Gemini or sending real messages. Keep substitute-generated artifacts temporary.

For architecture scenarios, additionally exercise disposable real user
containers and a real Node-service boundary. A mock call log cannot prove
process or filesystem isolation. Inspect runtime configuration and dependencies
for isolation, storage, and SDK placement. Any generated executable code,
including hostile fixtures, must run only in an isolated user container.
Never run a hostile fixture directly in the test runner, API, or host process.

For each scenario reset database records, clock, call logs, containers, and
artifacts. Drive asynchronous work through deterministic completion barriers;
do not depend on sleeps or a fixed worker speed. Capture status before and after
each barrier. Run every Scenario Outline example. A missing adapter or unresolved
product decision is BLOCKED, never PASS. An assertion failure is FAIL; all
assertions and architecture evidence are required for PASS.

## Coverage map

| Source requirement | Scenarios |
| --- | --- |
| Registration and authenticated access | AUTH-01, AUTH-02 |
| Lesson scope and 90-second maximum | LESSON-01, LESSON-02 |
| Dedicated containers, isolation, contained execution | CONTAINER-01, SECURITY-01, SECURITY-02 |
| 25-minute authenticated inactivity; active-job protection | LIFECYCLE-01 through LIFECYCLE-04 |
| Gemini generation, Manim, optional voiceover | PIPELINE-01, PIPELINE-02 |
| Separate Gemini evaluation of intent, defects, inconsistencies | EVALUATION-01 |
| Node/TypeScript Photon integration and recipient | DELIVERY-01, DELIVERY-02 |
| App-visible job status and Photon acceptance | STATUS-01 |
| Temporary videos, no persistent video storage | STORAGE-01 |
| Failure handling across the required workflow | FAILURE-01 |

The suite contains 19 scenario definitions; outlines compact repeated boundary
and failure cases. Cross-user and concurrency scenarios belong in the required
acceptance run, not just optional security testing.

## Decisions requiring clarification

These are not additional requirements silently imposed by the suite:

- Registration/authentication ownership, credentials/provider, phone validation
  and verification, and duplicate-registration behavior are unspecified.
  AUTH-01 tests the supported public registration flow once defined; it does
  not require FastAPI itself to implement a credential system.
- The implementation selects three public routes, JSON response schemas,
  polling, and explicit rejection/failure handling. Cancellation, restart
  recovery, delivery retries, and duplicate-submit semantics remain unresolved;
  the suite does not mandate additional endpoints.
- A container's initial inactivity timestamp, exact eligibility at 25:00, and
  the scheduler's shutdown delay are unspecified. Lifecycle assertions use
  24:59 and 25:01 and an explicit completed cleanup sweep. Decide the exact
  boundary separately. The active-job guard must remain atomic with stopping.
- Decide which authenticated requests refresh activity, including status polls,
  rejected requests, and authenticated internal callbacks. The suite uses valid
  user requests and excludes unauthenticated requests.
- The 90-second limit is explicit; rendered-duration verification is an
  acceptance check needed to demonstrate it. Scope estimation method and
  handling of overlong renders (retry, re-scope, or failure) are unspecified.
- Evaluator pass thresholds and rejection/remediation behavior are unspecified.
  A failed evaluation must not be presented as an approved completed lesson;
  decide how to expose findings or obtain an acceptable result.
- Photon acceptance is explicitly observable; it is not evidence of receipt.
  Internal completion now uses `accepted`, matching public polling. Confirmed
  receipt, acknowledgments, and callbacks remain unresolved; the Node contract
  supplies acceptance only. Do not require an unsupported receipt API.
- Temporary artifact cleanup deadline, delivery retries, restart recovery, and
  partial-render handling need definition. STORAGE-01 requires eventual cleanup
  when processing/delivery no longer needs the artifact, not deletion while a
  delivery service is still reading it. Generated code/text retention is not
  specified; the persistent-storage prohibition applies to generated videos.

These decisions affect adapter details or marked assertions; they do not excuse
violating isolation, executing code on the host, retaining videos persistently,
or stopping a container with an active job.

## Voiceover verification

Run the trusted worker's deterministic contract tests without dependencies:

```sh
python3 -m unittest backend.tests.test_voiceover_worker -v
```

These tests replace Manim and ffprobe; placeholder code and video bytes are never
executed or rendered on the host. They check request-setting handoff, rejection
of missing audio, silent rendering with voiceover disabled, probe failures,
and finite positive durations through the inclusive 90-second boundary.

For actual Manim rendering and ffprobe checks, build the current worker image
and explicitly enable the dedicated container suite:

```sh
docker build -f backend/container/Dockerfile -t btg-renderer:voiceover-test .
RUN_VOICEOVER_CONTAINER_TESTS=1 python3 -m unittest backend.tests.test_voiceover_container -v
```

Optionally set `VOICEOVER_TEST_IMAGE` to an image built from this worktree.
Each test uses a separate disposable, unprivileged user container with tmpfs,
no host mounts, no network, a read-only filesystem, and resource limits.
Fixture code and all rendering execute only inside that container. No Gemini,
GTTS, or Photon requests occur. Temporary videos disappear with container
removal. Without opt-in these tests are **skipped**, not evidence of rendering
or isolation. Opted-in tests fail if Docker or the renderer image is unavailable.

The real fixtures cover a requested voiceover missing audio, disabled voiceover
with a silent video, and a video containing an audio stream. The last fixture
uses silence intentionally: an audio stream does **not** prove audible speech,
accurate narration, synchronization, or GTTS integration. Those remain part of
the real voiceover/quality acceptance run.

## Executable architecture acceptance

From the repository root, install Python test dependencies and build the images:

```sh
docker build -f backend/container/Dockerfile -t btg-renderer:acceptance .
POSTGRES_PASSWORD=synthetic PROJECT_ID=synthetic PROJECT_SECRET=synthetic MESSAGING_TOKEN=synthetic AUTH_INTROSPECTION_URL=http://identity.invalid GEMINI_API_KEY=synthetic GEMINI_MODEL=synthetic docker compose --env-file /dev/null -p btg-acceptance build
USER_CONTAINER_IMAGE=btg-renderer:acceptance .venv/bin/python -m backend.tests.run_acceptance
```

The runner creates a unique PostgreSQL 17 container with tmpfs data and a random
loopback port; it ignores externally supplied database targets and never opens
credential `.env` files. It checks fresh SQL schema constraints, then runs the
combined Python suite with PostgreSQL, migration cases, real voiceover/render
containers, and architecture tests enabled. Skipped required checks cause failure.
Docker, cloudflared, and the freshly built images are prerequisites; missing
prerequisites are blocked, never passed. Containers and networks belonging to
this test run are removed only after their test jobs stop.

Architecture tests cover per-user UID/mount/capability/resource/network isolation,
host/other-user sentinel access attempts, rejected escaped artifacts, real Manim
rendering, Manim Voiceover with an offline synthetic speech service, the real
Node HTTP handler/SDK attachment builder with substituted Photon accept/reject/
no-op responses, polling during an active real-container job, inactivity stop,
restart, and success/partial-failure cleanup. Synthetic silent audio proves
pipeline wiring only; it is not narration-quality or live GTTS evidence.
Cloudflare checks validate allowlisted API paths and 404 fallbacks against a
real loopback coordinator origin, with no credentials, DNS changes, or live tunnel.

Provider signup/login/verification, real Gemini/GTTS quality, Photon cloud
transport and confirmed receipt remain external product/deployment blockers.
Offline acceptance verifies the implemented contracts and isolation without
sending messages or claiming live integration success.
