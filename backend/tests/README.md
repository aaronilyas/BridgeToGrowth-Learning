# FastAPI backend acceptance suite

This language-agnostic suite specifies the backend behavior required by
[agents.md](../../agents.md) and [product-overview.md](../../product-overview.md).
The Gherkin scenarios in [acceptance.feature](acceptance.feature) can be bound to
any test runner or executed as an acceptance checklist. They are specifications,
not currently runnable tests: the repository has database models and a schema,
but no FastAPI routes or job orchestration yet. No dependencies are added.

## Execution contract

Bind semantic operations such as registration, lesson submission, and status
retrieval to the eventual public API; do not assume route names, HTTP codes,
authentication mechanism, or exact status strings. Assert observable outcomes
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
- Public routes, response schemas, status transport (polling/push), errors,
  cancellation, retries, timeouts, and duplicate-submit semantics are unspecified.
  Select these before binding adapters; the suite does not mandate new endpoints.
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
  Receipt acknowledgments, callbacks, and the meaning of the existing
  `delivered` status need definition. Do not require an unsupported receipt API.
- Temporary artifact cleanup deadline, delivery retries, restart recovery, and
  partial-render handling need definition. STORAGE-01 requires eventual cleanup
  when processing/delivery no longer needs the artifact, not deletion while a
  delivery service is still reading it. Generated code/text retention is not
  specified; the persistent-storage prohibition applies to generated videos.

These decisions affect adapter details or marked assertions; they do not excuse
violating isolation, executing code on the host, retaining videos persistently,
or stopping a container with an active job.
