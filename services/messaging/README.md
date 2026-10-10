# BridgeToGrowth messaging service

The Node.js/TypeScript HTTP boundary for Photon Spectrum iMessage delivery. It
accepts lesson videos from the Python API and sends them to the requested
recipient. Videos stay in request-local memory; no video files are written.

## Environment

On a fresh checkout, copy `.env.example` to `.env` and configure:

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
npm start
```

Node.js 22.6+ runs the compiled `dist/index.js` entry point. Node does not
automatically load `.env`; supply environment variables through your process
manager, Compose, or explicitly use `node --env-file=.env dist/index.js` as an
operator. `npm run dev` builds and watches emitted JavaScript. Rebuild TypeScript with
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
can send duplicate messages. No persistent delivery queue or video storage is
introduced. Shared Photon lines may require recipients to be registered as
project users; a routing or allowlist rejection returns 502.

See [Spectrum docs](https://photon.codes/docs/spectrum-ts),
[product-overview.md](../../product-overview.md), and
[agents.md](../../agents.md). SDK calls remain here; generated Manim code runs
only in isolated user containers.
