# BridgeToGrowth Learning

Request lessons explained in videos of at most 90 seconds, rendered in isolated
user containers and handed to Photon for messaging. See
[product-overview.md](product-overview.md) and [agents.md](agents.md).

- `backend/`: [FastAPI coordinator](backend/README.md), PostgreSQL metadata,
  isolated Manim renderer, and [executable acceptance checks](backend/tests/README.md).
- `services/messaging/`: [Node.js/TypeScript Photon endpoint](services/messaging/README.md).
  Authenticated `POST /video` accepts temporary MP4 bytes and returns HTTP 202
  only after Photon returns a message ID. Acceptance does not confirm receipt.
- `frontend/`: [Expo React Native mobile app](frontend/README.md) with secure
  sessions, lesson submission/progress/cancellation and account management.
- [compose.md](compose.md): single-coordinator deployment with a loopback API.
- [cloudflare.md](cloudflare.md): host-based tunnel exposing only authentication, account and lesson routes.
- [prompts.md](prompts.md): consolidated request history with explicit prompt-origin labels.

With Node.js 22.6+ installed, verify messaging without credentials or messages:

```sh
cd services/messaging
npm ci
npm run typecheck
npm run build
npm test
```

Supply Photon credentials and `MESSAGING_TOKEN` through the service environment
before `npm start`. Node does not automatically load `.env`; see the service
README for explicit operator configuration. Credential files stay outside Git.

Signup, phone verification, login, rotating opaque sessions, recovery and phone
changes are owned by the [backend](backend/AUTHENTICATION.md).

To run the backend stack locally, install Docker with Compose and Python 3,
copy `.env.example` to `.env`, and fill the required backend credentials. Run
`./start-backend.sh` to build the images and start PostgreSQL, messaging and
FastAPI. Run `./stop-backend.sh` to drain active jobs and stop the stack without
deleting volumes or user containers. Shutdown waits without a forced-kill
timeout. Set `ENV_FILE=/path/to/config` to use a different environment file.
The frontend runs separately using `frontend/.env`. For an existing database,
follow the upgrade instructions in [compose.md](compose.md) before starting.

Photon SDK calls stay in TypeScript. Generated Manim code executes only inside
isolated user containers; generated videos remain temporary. Provider DM read receipts are consumed as independent evidence; missing receipts
remain unconfirmed. Cancellation, submission idempotency, persisted crash cleanup
and enforced renderer egress are implemented. Live provider and full mobile
integration checks are deferred until the frontend is ready; see
[verification and handoff](backend/INTEGRATION.md).
