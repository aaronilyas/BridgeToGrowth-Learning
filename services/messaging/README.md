# BridgeToGrowth messaging service

The Bun/TypeScript boundary for Photon Spectrum, configured for iMessage.
This scaffold currently echoes incoming text. It does not yet accept lesson
jobs from FastAPI or send generated videos.

The Python API, user-container lifecycle, Gemini/Manim pipeline, and React
Native application are separate components. See
[product-overview.md](../../product-overview.md) and
[agents.md](../../agents.md).

## Environment

The initializer populated the local, gitignored `.env`. On a fresh checkout,
copy `.env.example` to `.env` and configure the project credentials:

From your project Settings on the [Photon dashboard](https://app.photon.codes):

- `PROJECT_ID`: `a96c8fdb-17f1-4c49-94f6-3ec6e12f565e`
- `PROJECT_SECRET`: the project's secret; never commit it.

## Run

```sh
bun install --frozen-lockfile
bun run typecheck
bun start
```

Run these commands from `services/messaging/` so Bun loads the service's
`.env`. `bun start` connects to Spectrum and sends echo replies to incoming
text messages; use it only when that behavior is wanted. `bun run dev` enables
watch mode. Type checking does not connect to Photon or send messages.

## Where to go next

- [Spectrum docs](https://photon.codes/docs/spectrum-ts)
- Define the authenticated FastAPI-to-service delivery contract before
  replacing the echo loop with lesson-video delivery.
- Keep Photon SDK calls here. Never execute generated Manim code in this
  service or retain generated videos persistently.
- Use the installed SDK's provider exports and the bundled Spectrum reference
  under `.agents/skills/spectrum/` when extending the integration.
