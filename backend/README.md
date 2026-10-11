# BridgeToGrowth backend

FastAPI owns accounts and authentication and coordinates short lessons.
PostgreSQL stores account, session, job, evaluation and message metadata, never
videos. Generated Python and Manim rendering run only in each user's isolated
container. Optional Manim Voiceover uses GTTS. A fresh independent Gemini request
evaluates the actual rendered video before TypeScript/Node sends it through
Photon. See [product requirements](../product-overview.md), [account/mobile API
contracts](AUTHENTICATION.md), [Compose deployment](../compose.md) and
[automated verification](tests/README.md).

## Public lesson API

All routes below require an access bearer. Requests reject unknown fields; owner
IDs and recipients are server-derived. Unknown and other-account job IDs both
return 404. All responses use `Cache-Control: no-store`.

| Endpoint | Request | Response |
| --- | --- | --- |
| `POST /lessons` | `{ "topic": "Explain gravity", "voiceover": false }` | 202 job snapshot; background processing starts after response |
| `GET /lessons/{uuid}` | No body | 200 owned job snapshot |
| `POST /lessons/{uuid}/cancel` | No body | 202 snapshot with `cancel_requested: true`, or 409 after messaging cutoff |

`topic` is trimmed and must have 1–10,000 characters; `voiceover` defaults to
false. Optional `Idempotency-Key` is 1–128 ASCII letters/digits or `._:-`.
The key is scoped to the authenticated UUID. Same key and normalized request
(topic plus voiceover) returns the original job's current snapshot without
another pipeline or message. Different content with the same key returns 409.
Database uniqueness plus the single coordinator's admission lock prevent
concurrent duplicates. Keys remain reserved while their job exists. Without a
key every request is a new job. This provides submission idempotency, with no
claim of provider-side send deduplication. Never retry an ambiguous send by
creating another lesson unless the user knowingly requests a new message.

Job snapshot (nullable fields shown with example values):

```json
{
  "id": "<uuid>", "status": "accepted",
  "estimated_duration_seconds": 75, "rendered_duration_seconds": 74.2,
  "feedback": null, "failure_reason": null,
  "evaluation": { "approved": true, "accurate": true, "defect_free": true, "consistent": true, "findings": "" },
  "cancel_requested": false, "cleanup_pending": false,
  "photon_accepted": true, "provider_message_id": "<provider ID>",
  "receipt_status": "unconfirmed", "read_at": null
}
```

`evaluation` is null until evaluation completes, then contains all required
boolean checks, `approved` and at most 4,000 characters of findings. Requested
voiceover adds `narration_accurate`, `narration_intelligible` and
`narration_consistent`. Scope feedback asks the user to break down requests
estimated above 90 seconds. Actual duration must be finite, positive and at
most 90 seconds. Requested audio must have an audio stream, and every visual,
accuracy, consistency and requested narration check must pass. Rejected findings
remain available to the owner; provider exceptions and secrets are not exposed.
Videos above 12 MiB fail before inline evaluation rather than being retained.

## Status meanings and cancellation

Active stages are `queued`, `validating`, `generating`, `rendering`, `evaluating`,
`delivering` (legacy `requested` is recognized during recovery). Poll until a
terminal status. Cancellation acknowledgement records intent; continue polling
until the terminal outcome and `cleanup_pending: false`.

| Terminal status | Exact meaning |
| --- | --- |
| `needs_breakdown` | Estimated lesson exceeds 90 seconds; no render or message |
| `failed` | A pre-send step failed, including duration/audio/evaluation; no confirmed acceptance |
| `cancelled` | Owner's cancellation won before messaging cutoff; no message was started |
| `interrupted` | Previous coordinator stopped before messaging, and actual container processes have stopped; no automatic resume |
| `delivery_unknown` | A send may have been accepted, but acceptance cannot be established (timeout, lost response, acceptance commit failure, interrupted handoff); never automatically resent |
| `accepted` | Photon returned a nonempty message ID and acceptance/job completion were committed together; receipt is independent |

Cancellation is owner-only and repeatable before messaging. During generation
or rendering the trusted worker kills generated processes inside the owning
container. Evaluation is allowed to finish its external call but cannot advance
to sending once cancellation wins. Queued jobs are cancelled when their worker
gets execution; cancellation never kills another queued job's active render.
Temporary `/work` and `/tmp` artifacts are removed before protection is released.
Cancellation after `delivering`, `accepted` or `delivery_unknown` returns 409;
no message retraction is claimed. Other already-terminal outcomes return their
snapshot unchanged. Cleanup failures remain persisted and protected for retries.

## Receipt evidence

The installed Spectrum/iMessage packages are 12.10.1. Their authenticated cloud
stream emits DM read events with the reader, outbound target message ID and read
time. Node consumes that documented contract and forwards signed events to
private `POST /internal/receipts`. It spools only receipt metadata durably during
backend outages, signs each retry afresh, and removes evidence only after 204.
The backend verifies HMAC-SHA256 over `timestamp + "." + exact JSON bytes`, a
five-minute timestamp window, bounded bodies and event shape. `RECEIPT_SECRET`
is independent of account/code and messaging secrets. Forged events cannot
update state. A unique event ID prevents conflicting reuse; duplicate and
out-of-order read events cannot regress evidence. Early events are saved and
applied after acceptance commits. Correlation requires the unique provider
message ID AND the captured send-time phone; callers cannot name a lesson owner.
Callbacks never update authenticated activity and are not publicly routed.

`receipt_status` is `read` only with correlated provider evidence; `read_at` is
an ISO-8601 UTC timestamp from that event. Otherwise it is `unconfirmed`.
`accepted` remains the job status even after a receipt. No delivery-only event
is exposed by the installed iMessage adapter, and recipients can disable read
receipts. Missing/unresolvable upstream targets or absent receipts cannot confirm
receipt; there is no elapsed-time or HTTP-success inference. Historical
`delivered_at` stays unused, and legacy delivery rows without a send-time phone
cannot acquire fabricated receipt attribution. See [official inbound read
receipt contract](https://photon.codes/docs/spectrum-ts/providers/imessage/messaging-features/inbound-read-receipts)
and [messaging adapter evidence](../services/messaging/README.md#provider-contract-evidence).

## Startup recovery and lifecycle

Exactly one coordinator holds PostgreSQL advisory lock 78264019. Admission,
cancellation cutoff and inactivity shutdown share per-account locks; execution
is serialized per user. No broker or extra coordinator is required. At startup,
after acquiring the guard, reconcile stored jobs with the deterministic owned
Docker container and actual process state. Preserve any genuinely active process;
new admission for that account returns 409 until recovery completes. Sweeps
retry observations every 30 seconds. Once no old process remains, trusted cleanup
removes abandoned files (including renamed work and `/tmp` artifacts), then
committed acceptance wins, an interrupted send becomes `delivery_unknown`, and
pre-send jobs become `interrupted` or `cancelled`. No old job is automatically
rerun and no video is resent. Stopped/missing containers have no tmpfs artifacts;
orphan egress helpers are stopped. Runtime/database uncertainty retains protection
and retries rather than declaring work stopped. Pending cleanup flags are written
before startup/artifact creation and survive coordinator loss, even for terminal
jobs. Inactivity eligibility is restored only after work and cleanup finish.

Access-authenticated account/lesson requests refresh inactivity. After at least
25 minutes without one, the 30-second sweep stops the renderer and its egress
helper only when no reserved, persisted active or cleanup work remains.
Temporary files never use persistent volumes. Gemini generation executes inside
the user container; rendering processes receive no Gemini credentials. Evaluation
is a separate request containing the actual video and original intent. All
failures log IDs/stages rather than credentials or provider bodies.

## Installation and configuration

```sh
python3 -m venv .venv
.venv/bin/pip install -r backend/requirements.txt -r backend/tests/requirements.txt
docker build -f backend/container/Dockerfile -t btg-renderer:local .
docker build -f deployment/egress/Dockerfile -t btg-egress:local .
# Initialize a fresh PostgreSQL database with backend/schema.sql and export settings.
.venv/bin/uvicorn backend.main:app --host 127.0.0.1 --port 8000 --workers 1
```

Production lifespan fails clearly without `DATABASE_URL` (PostgreSQL+psycopg),
`AUTH_CODE_SECRET`, `RECEIPT_SECRET`, `GEMINI_API_KEY`, `GEMINI_MODEL`,
`MESSAGING_URL` (the trusted service's full `/video` URL), `MESSAGING_TOKEN`, or
`RENDERER_EGRESS_IMAGE`. Secrets for code HMAC, receipts and messaging need at
least 32 characters and must be distinct random deployment secrets. Optional
`USER_CONTAINER_IMAGE` defaults to `btg-renderer:local`. Models must be safe IDs
and support video input. Missing images, proxy initialization failure or legacy
unrestricted containers fail closed before generated execution. Keep PostgreSQL,
Node, Docker socket and receipt callbacks private. Use the credential-free
[deployment example](../deployment/.env.example), [egress policy](../deployment/egress/README.md)
and [Cloudflare route allowlist](../cloudflare.md).

## Database upgrade

Fresh databases use `schema.sql` only. Existing original databases require
`001_delivery_acceptance.sql` then `002_owned_auth_and_recovery.sql`, each once;
if 001 was already applied, run only 002. Drain/stop the coordinator, back up
PostgreSQL, and use `psql -v ON_ERROR_STOP=1`. These are transactional offline
migrations, never automatic startup writes to a live database. Existing UUIDs,
foreign keys, phone numbers and historical delivery metadata are preserved.
No password, session, verification timestamp or invitation is fabricated.
Legacy interrupted jobs receive cleanup obligations. The provider-ID uniqueness
constraint deliberately fails if historical IDs are ambiguous; review duplicate
provider evidence before upgrading, without assigning one receipt to two jobs.
Legacy send-time phone is left null because current phone is not historical proof.

After draining, stop/remove old dynamically-created unrestricted renderer
containers and their networks, preserving the database. Do not remove active
containers. The new runtime refuses to reuse legacy unrestricted network modes.
Build the egress image on the same daemon, start one coordinator, verify automatic
reconciliation, then issue legacy enrollment invitations only after checking the
original account holder. See [Compose commands](../compose.md).

## Verification and later integration

Implemented behavior and offline evidence are documented in [INTEGRATION.md](INTEGRATION.md).
Run [the required acceptance suite](tests/README.md) now. Synthetic audio proves
stream/wiring checks only; mocked Gemini results prove validation, not real
accuracy, narration quality or synchronization. Live provider and complete
frontend testing are deliberately deferred until the frontend is ready.

Later checklist:

- [ ] Real phone signup, verification/resend, login, rotation/reuse, recovery,
  logout and phone change using intended test recipients and mobile secure storage.
- [ ] Legacy invitation/enrollment with real support identity checks and unchanged UUIDs.
- [ ] Real Gemini generation and independent video/narration evaluation, including
  overlong/incorrect/visually defective lessons and intelligible synchronized GTTS.
- [ ] Photon plan/recipient allowlist compatibility and real verification/video
  acceptance; DM read receipts enabled/disabled, SDK catch-up and outage retries.
- [ ] Production allowlisted proxy connectivity to the required Gemini/GTTS hosts;
  no direct/private control-service access from generated code.
- [ ] Production tunnel DNS/TLS, client-address trust and no caching of account routes.
- [ ] Frontend submission idempotency, polling/feedback, cancellation races,
  offline/resumed sessions, receipt UI and `delivery_unknown` without duplicate sends.
- [ ] Controlled crash during rendering/evaluation/send and persisted cleanup
  recovery in the final deployed topology, using disposable test accounts.
