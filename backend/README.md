# FastAPI backend

At a high level, the API identifies the user, records a lesson job, and moves it
through scope checking, isolated generation/rendering, independent evaluation,
and a Node delivery handoff. PostgreSQL stores accounts and progress, never
videos. Each user's Docker container keeps job files on tmpfs. Videos pass to
Gemini evaluation and the Node service in memory, then the job directory is removed.

There are three application routes (plus FastAPI's generated API docs):

| Route | Purpose |
| --- | --- |
| `PUT /account` | Register the authenticated identity and its verified phone; idempotent |
| `POST /lessons` | Accept `{ "topic": "Explain gravity", "voiceover": false }`, return job ID with HTTP 202 |
| `GET /lessons/{id}` | Poll progress for an owned job; unknown and other-user IDs both return 404 |

All routes require `Authorization: Bearer <session>`. Owner IDs and recipients
are derived from authentication, never accepted in a lesson request.
Poll until `needs_breakdown`, `failed`, or `accepted`. `accepted` means Photon
accepted the message, not that the user received it. Earlier stages are
`queued`, `validating`, `generating`, `rendering`, `evaluating`, `delivering`.
An overlong estimate produces breakdown feedback; an overlong actual render or
any failed evaluation fails the job without sending it. All three evaluator
checks (accuracy, no defects, consistency) must pass. No automatic delivery
retry occurs after a timeout because acceptance might already have happened.

## Run

From the repository root:

```sh
python3 -m venv .venv
.venv/bin/pip install -r backend/requirements.txt
docker build -f backend/container/Dockerfile -t btg-renderer:local .
# Apply backend/schema.sql to a fresh PostgreSQL database, then export settings.
.venv/bin/uvicorn backend.main:app --workers 1
```

Required environment variables:

- `DATABASE_URL`: PostgreSQL SQLAlchemy URL, using `postgresql+psycopg://...`.
- `AUTH_INTROSPECTION_URL`: trusted identity provider's HTTP endpoint.
- `GEMINI_API_KEY`, `GEMINI_MODEL`: credentials and a video-capable model ID.
- `MESSAGING_URL`, `MESSAGING_TOKEN`: trusted Node HTTP endpoint and shared secret.
- Optional `USER_CONTAINER_IMAGE`: defaults to `btg-renderer:local`.

The API host needs Docker CLI access. This access is never passed into user
containers: there are no host mounts, Docker sockets, or persistent volumes.
Each user has a separate Docker bridge network to prevent direct cross-user
container networking. Containers use an unprivileged UID, read-only root filesystem, dropped
capabilities, no privilege escalation, and memory/CPU/process limits. Each
user gets a deterministic container name, and jobs for that user run serially.
Scope checking does not start a container. Generation calls Gemini inside the
user container; rendering invokes Manim only there. Evaluation uses a fresh
Gemini request containing the actual video and original intent. Video size is
limited to 12 MiB for inline evaluation; larger output fails rather than being
persisted or uploaded to durable storage. Worker rendering times out after
five minutes and reaps remaining render processes before artifact handling.

Every authenticated request for a registered user refreshes activity, including
polls and rejected lesson bodies. Unauthenticated requests do not. A sweep every
30 seconds stops containers idle for at least 25 minutes, only when there are
no reserved jobs, nonterminal persisted jobs, or pending cleanup operations.
Admission and shutdown share a user lock. Cleanup failure retains protection
and subsequent sweeps retry cleanup. Stopped containers restart on demand;
tmpfs contents disappear on stop.

## External contracts and unresolved product choices

The product does not specify an identity provider, phone verification flow,
or Node HTTP delivery interface. These are explicit integration contracts,
not implemented credential or Photon services:

- Authentication performs an HTTP GET to `AUTH_INTROSPECTION_URL`, forwarding
  the bearer token. It requires JSON `{ "active": true, "user_id": "<stable UUID>",
  "phone_number": "+15551234567", "phone_verified": true }`. Expired/revoked
  sessions must return inactive. The provider owns signup, login, and phone
  verification. Registration refuses conflicting phones; phone changes need
  a separate product decision. Use HTTPS for remote service URLs.
- Delivery performs HTTP POST to `MESSAGING_URL` with raw MP4 bytes,
  bearer `MESSAGING_TOKEN`, `X-Lesson-Job`, and `X-Recipient` headers. Node must
  authenticate the request, consume the video, send via Photon, and return
  `{ "accepted": true, "message_id": "..." }` only after provider acceptance.
  It must not retain the video. The [messaging service](../services/messaging/README.md)
  implements this contract at `/video`. No Photon dependency is added to Python.

Run exactly one API process. A PostgreSQL advisory lock rejects a second
coordinator. FastAPI background tasks provide a simple in-process worker;
a queue/broker and multiple API workers are deliberately not introduced.
Graceful shutdown waits for background work. Abrupt process loss has no
automatic resume or retry: persisted nonterminal jobs protect their containers
from shutdown. An operator must confirm old work has stopped, clean temporary
artifacts, and mark interrupted jobs failed before restarting normal processing.
If PostgreSQL cannot save a failure, the prior stage remains visible until
reconciliation. Cleanup retries are in memory and likewise need reconciliation
after an abrupt restart. Restart recovery, cancellation, phone updates,
production egress policy, and receipt callbacks remain product decisions.

## Verification

```sh
.venv/bin/pip install -r backend/tests/requirements.txt
.venv/bin/python -m unittest discover -s backend/tests -v
```

Tests use deterministic substitutes and a disposable SQLite database by default.
To exercise actual PostgreSQL types/constraints, set `TEST_DATABASE_URL` to a
**disposable** PostgreSQL database: tests drop and recreate its tables.
The tests never execute generated code or send messages. Real Docker isolation,
Manim/voiceover, Gemini quality, and the real Node/Photon handoff still require
the architecture acceptance run in [tests/README.md](tests/README.md).
See [Gemini's generateContent contract](https://ai.google.dev/api/generate-content)
and [FastAPI background tasks](https://fastapi.tiangolo.com/tutorial/background-tasks/).

## Voiceover artifact check

The container worker records the requested voiceover flag in the temporary job
directory during generation, because render commands carry only the job ID.
After rendering, ffprobe checks the copied MP4's duration and stream types.
Requested voiceover without an audio stream fails rendering before evaluation
or delivery; a video with voiceover disabled may be silent or contain audio.
Only successful checks expose `video.mp4` for downstream reads. Videos must
still have a finite positive duration of at most 90 seconds, and the existing
12 MiB limit applies. Request metadata and pending video bytes stay in the
user container's tmpfs until normal job cleanup.

This checks audio-stream presence only. It does not establish speech, narration
accuracy, audibility, or synchronization. See the dedicated mocked and isolated
container checks in [tests/README.md](tests/README.md#voiceover-verification).
