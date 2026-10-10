# BridgeToGrowth Learning

An application for requesting lessons explained in videos of no more than
90 seconds, rendered in isolated user containers and sent through Photon.
See [product-overview.md](product-overview.md) for the product architecture and
[agents.md](agents.md) for development constraints.

## Repository layout

- `backend/`: Python SQLAlchemy models, PostgreSQL schema, connection helpers,
  and [FastAPI acceptance specifications](backend/tests/README.md). FastAPI
  routes and generation/container orchestration are not implemented yet.
- `services/messaging/`: Bun/TypeScript Spectrum service configured for
  iMessage and project `a96c8fdb-17f1-4c49-94f6-3ec6e12f565e`. The generated
  entry point currently echoes incoming text; lesson-video delivery and the
  authenticated FastAPI-to-service contract still need implementation.
- `frontend/`: reserved for the React Native application; currently empty.
- `prompts.md`: request history. `prompt.md` retains earlier database requests.

## Messaging scaffold

Install Bun 1.3 or newer, then run:

```sh
cd services/messaging
bun install --frozen-lockfile
bun run typecheck
```

The initializer populated the service's gitignored `.env` with Spectrum
credentials. On a fresh checkout, copy `.env.example` to `.env` and fill in
`PROJECT_SECRET` from the project's Photon dashboard. See the
[service README](services/messaging/README.md) before starting the echo app.

Photon integration belongs exclusively in the TypeScript service. Generated
Manim code must execute only in isolated user containers, and generated videos
must remain temporary. The scaffold does not yet implement that pipeline.
