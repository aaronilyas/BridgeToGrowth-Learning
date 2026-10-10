# Backend integration verification — 2026-10-10

Integration branch: `integration/backend-20261010`, with its dedicated worktree
at `/home/aaron/BridgeToGrowth-integration`. The branch started from freshly
fetched `origin/main` (`407c7a26433e38d4fd2ee0c03f849f9dbda2b249`).

## Source inventory

At first only Compose was available locally or remotely. After the user supplied
pulled changes, all six completed source commits were available on GitHub and
merged with their history. Local source branches are retained:

- `backend/account-onboarding`: `a55e67c1dcc352fb2828f5417731011b42963b40`.
- `backend/delivery-semantics`: `89f534c9d7ea397a94e1d893c260febe1471fbb7`.
- `backend/voiceover-verification`: `cd9095b2ce2d99445fc21ef7dc33dc76b3a18e4b`.
- `backend/compose-setup`: `1f2146373f2080a44ee74273db0d046cd3fb1f12`.
- `backend/cloudflare-tunnel`: `53e6fda05e801c12fb79225beaf5ed3abd1f7a61`.
- `backend/node-runtime`: `4bf3f587e30c09aff6c53731819b0868498850f0`.

No source worktrees for these branches were attached to the local repository.
The main worktree and a separate older clone were clean. No source worktree or
branch was deleted, and no active source writer was modified. Every distinct
source `prompts.md` entry was checked against the integrated file and preserved.
No additional architecture-acceptance branch or implementation was found, so
executable isolation/lifecycle/HTTP/ingress tests were added during integration.

## Integration fixes

Compose now compiles TypeScript and installs production dependencies from
`package-lock.json` in a Node image, then runs emitted JavaScript. Its healthcheck
and build allowlist use Node and npm. Repository, messaging, and deployment
documentation match the authenticated Photon endpoint. Development startup also
uses compiled JavaScript because this host's Node build omits TypeScript stripping.

Photon acceptance and job completion are atomic and terminal, with no fabricated
receipt state. Migration tests cover legacy delivery/job completion, malformed
acceptance evidence, and interrupted split transactions. Existing Compose volumes
require a drained/stopped coordinator, backup, and the documented migration;
no migration was applied to a live database.

Requested voiceover requires an audio stream and separate narration evaluator
checks. Audio presence, including synthetic silence, is not proof of narration
quality. The actual container run found missing `ffprobe` in the base image;
the renderer now installs FFmpeg and SoX. Tracked Python bytecode was removed
and existing ignore rules retained. Cloudflare uses the host's loopback API
origin, API path allowlist, and 404 fallback; private services remain unexposed.

## Required checks passed

- Clean messaging `npm ci`, TypeScript typecheck, emitted-JavaScript build, and
  all **7** messaging tests. Compiled startup fails closed without a token.
- Combined Python suite: **51 tests, zero failures, zero skips**. The acceptance
  runner creates PostgreSQL 17 with tmpfs data and a random loopback port.
- Fresh SQL schema checks and legacy delivery migration checks against that
  disposable PostgreSQL; real PostgreSQL also verifies the single-coordinator
  advisory lock and atomic acceptance rollback.
- Compose configuration validation with synthetic settings and `/dev/null` as
  the env file; messaging, coordinator, and renderer image builds.
- Real disposable containers: actual Manim rendering, Manim Voiceover with an
  offline MP3 speech substitute, missing-audio rejection, narration rejection,
  real Node HTTP delivery/SDK attachment building with substituted Photon
  acceptance/rejection/no-op responses, polling during active work, 25-minute
  inactivity stop and restart, success/partial-failure cleanup, host/other-user
  sentinel and network isolation, and escaped-artifact rejection.
- Synthetic Cloudflare ingress validation/rule checks, including private-path
  and other-host denial, against a real disposable loopback coordinator API.

Environment: Python 3.12.13, Node 22.22.1, npm 9.2.0, Docker 29.6.2,
Compose 5.3.1, PostgreSQL 17. Reproduce with the commands in
[tests/README.md](tests/README.md). Generated fixtures executed only in isolated
containers. No credential `.env` files were read or committed; no real messages
were sent. Test containers/networks were removed after their jobs completed.

A final fetch after successful verification found `origin/main` unchanged at
`407c7a26433e38d4fd2ee0c03f849f9dbda2b249`; no new main changes required retesting.
Only documentation/evidence was added after the final successful executable run.

## Remaining product and deployment blockers

Identity-provider choice, signup/login and verified-phone onboarding remain
unimplemented external decisions. Confirmed user receipt needs a supported
receipt contract; acceptance does not mean receipt. Live Gemini/GTTS narration
quality, Photon cloud credentials/transport, production tunnel credentials/DNS,
and production egress policy were not exercised by synthetic acceptance.
Cancellation, phone changes, safe retries/idempotency, and automated crash
recovery/reconciliation remain documented product choices.

The existing Spectrum SDK dependency chain still reports moderate npm audit
findings (14 with host npm, 18 with image npm). No forced dependency overrides or
SDK upgrade were introduced; compatibility review remains documented in
[node-runtime.md](../node-runtime.md). These findings do not invalidate the
executed offline checks or establish live provider readiness.
