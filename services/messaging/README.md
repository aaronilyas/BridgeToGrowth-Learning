# BridgeToGrowth messaging service

The Node.js/TypeScript HTTP boundary for Photon Spectrum iMessage delivery. It
accepts lesson videos from the Python API and sends them to the requested
recipient. Videos stay in request-local memory; no video files are written.

## Environment

Backend deployment uses the single repository-root `.env` and
[operator lifecycle](../../compose.md); do not create a second service secret file.
Compose derives private transport/callback addresses and limits. Standalone
transport development must supply these settings through its process manager:

- `PROJECT_ID` and `PROJECT_SECRET`: Spectrum project credentials from the
  [Photon dashboard](https://app.photon.codes).
- `MESSAGING_TOKEN`: a strong random shared secret, identical to the Python
  API's `MESSAGING_TOKEN`. Startup refuses an empty or missing token.
- `HOST` / `PORT`: defaults to `127.0.0.1:3001`. Set the host for your service
  network if Python runs in a separate container.
- `MAX_VIDEO_BYTES`: maximum upload size, defaulting to 50 MiB. Both declared
  lengths and chunked uploads are bounded.

Set the Python API's `MESSAGING_URL` to this service's full `/video` URL, for
example `http://127.0.0.1:3001/video`. Use HTTPS for remote service URLs.
Keep credentials out of version control.

## Run and verify

From `services/messaging/`:

```sh
npm ci
npm run typecheck
npm run build
```

Node.js 22.6+ runs the compiled `dist/index.js` entry point. Node does not
automatically load `.env`; supply environment variables through your process
manager or Compose. `npm start` connects the configured service to Photon;
use the root deployment operator for the deployed backend. `npm run dev` builds and watches emitted JavaScript. Rebuild TypeScript with
`npm run build` after editing, or run `npm run build -- --watch` in another
terminal. No TypeScript runtime loader is required. The service implements the authenticated Photon
video endpoint. Shutdown finishes active
HTTP requests before disconnecting Photon.

Run the offline tests with Node 22.6+ and npm (tests compile before execution):

```sh
npm test
npm run typecheck
```

Tests run a local HTTP server and mock Photon calls. They cover authorization,
request rejection, bounded uploads, complete-body consumption, recipient and
attachment routing, provider rejection, and delayed acceptance. They neither
read credentials nor send real messages.

## HTTP contract

`POST /video` matches `backend/integrations.py`:

- `Authorization: Bearer <MESSAGING_TOKEN>`
- `Content-Type: video/mp4`
- `X-Recipient`: verified E.164 phone number
- `X-Lesson-Job`: nonempty job identifier
- Body: raw, nonempty MP4 bytes (no JSON, base64, or multipart envelope)

The service checks the shared token before consuming the upload, resolves the
recipient through the iMessage provider, and sends a Buffer attachment named
`lesson.mp4`. A complete upload and a successful Photon send returning a
nonempty provider message ID are required for HTTP 202:

```json
{ "accepted": true, "message_id": "<Photon message ID>" }
```

Errors return JSON with an `error` field: 401 for authorization, 400 for invalid
recipient/job headers or empty/incomplete bodies, 415 for content type, 413 for
oversized videos, and 502 for Photon rejection or a missing acceptance ID.
Unknown paths return 404; other methods on `/video` return 405. Provider errors
are not exposed to callers. Content type is checked; the service does not
parse or render MP4 content.

Acceptance means Photon accepted the send, not a delivery/read receipt. The
job identifier is required metadata, not an idempotency key; repeated requests
can send duplicate messages. No persistent video delivery queue or video storage is
introduced. A separate receipt-metadata spool is described below. Shared Photon lines may require recipients to be registered as
project users; a routing or allowlist rejection returns 502.

See [Spectrum docs](https://photon.codes/docs/spectrum-ts),
[product-overview.md](../../product-overview.md), and
[agents.md](../../agents.md). SDK calls remain here; generated Manim code runs
only in isolated user containers.

## Verification text transport

Private `POST /verification` requires the same shared bearer and
`Content-Type: application/json`, with exactly `{ "recipient": "+15551234567",
"code": "012345" }`. Uploads are bounded to 1 KiB, and the recipient/code are
validated before contacting Photon. TypeScript resolves the DM and calls the
installed `text()` builder with a short branded code/expiry message. HTTP 202
requires a nonempty SDK acceptance ID; no-op/missing/rejected sends return 502.
No password, account or verification state belongs to Photon or Node. Codes
remain only in request-local memory and are never logged or written to disk.
This endpoint is private and is not a production verification bypass.

## Receipt consumer and metadata spool

Set `RECEIPT_URL` to the backend's private `/internal/receipts`, `RECEIPT_SECRET`
to an independent random secret of at least 32 characters, and `RECEIPT_SPOOL_DIR`
to a private writable directory. Startup requires all three. Compose uses its
private service network and a named metadata-only `/receipts` volume owned by
Node UID 1000. Keep that volume through ordinary restarts; never put videos,
verification codes or credentials there. For host deployment, create the directory
with owner-only permissions for the Node process. The SDK stream consumes only
identified DM read receipts targeting an outbound message; other messages are
ignored, with no automatic replies.

Receipt JSON is `{ "event_id": "<SDK event ID>", "message_id": "<outbound target ID>",
"recipient": "<reader E.164>", "read_at": "<ISO-8601 timestamp>" }`. The callback
uses `X-Receipt-Timestamp` (Unix seconds) and `X-Receipt-Signature` (hex HMAC-SHA256
over `timestamp + "." + exact UTF-8 JSON bytes`). Node queues metadata atomically,
retries backend outages every five seconds with a fresh signature and a ten-second
request timeout, and removes successfully acknowledged items after 204. A 400/409 rejection is
quarantined as `.rejected` metadata and logged generically for operator review.
A failed consumer or enqueue stops new service admission; callback failures
retain queued metadata for retry. Never silently acknowledge
receipt evidence that could not be recorded. Authentication and ownership checks
remain in FastAPI. No public Photon webhook route is necessary.

Spool JSON, interrupted `.tmp` writes and quarantined `.rejected` evidence expire
at seven days from filesystem arrival time. Expiry runs before callback retries
so a failing young callback cannot retain older files. Malformed JSON is
quarantined and continues to expire. Processing outages extend retention until
retry processing resumes. Account deletion cannot retract an accepted message;
spool evidence can remain until acknowledgement or expiry. The coordinator
discards late callbacks for removed recipients without surviving account/delivery
records. Database account history and backup retention are documented in
[account deletion](../../backend/AUTHENTICATION.md#admission-and-durable-account-deletion)
and [backup/restore policy](../../compose.md).

## Provider contract evidence

The lockfile-installed `spectrum-ts`, `@spectrum-ts/core` and
`@spectrum-ts/imessage` are 12.10.1. Verified before implementing these adapters:

- Installed core `dist/app-*.d.ts` declares `text(string): ContentBuilder`; the
  cloud provider's text dispatcher sends it to its SDK transport. The official
  [text guide](https://photon.codes/docs/spectrum-ts/content/text) confirms
  `space.send(text(...))`. Offline tests build the real installed content shape.
- Installed iMessage `dist/index.js`, `src/remote/read-receipts.ts` region,
  maps authenticated `message.read` cloud events to `content.type: "read"`,
  `content.target` (outbound message), sender (reader) and device read timestamp.
  The [official inbound read guide](https://photon.codes/docs/spectrum-ts/providers/imessage/messaging-features/inbound-read-receipts)
  confirms the same contract, DM attribution and catch-up replay semantics.
- Read evidence depends on the recipient enabling Send Read Receipts; unresolved
  upstream targets may be dropped. The installed adapter does not expose a
  delivery-only confirmation event. No absence-of-receipt inference is made.
  Shared-line recipient allowlists still apply to both verification and video;
  this is iMessage transport, with no guaranteed universal SMS fallback.

Typecheck/build and the offline tests cover transport wiring, not real provider
receipt availability. Live provider and full mobile verification are deferred
until the frontend is ready; see the backend's later integration checklist.
