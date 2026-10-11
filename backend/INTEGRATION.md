# Backend completion and verification handoff

This implementation supersedes the initial integration's external authentication
and manual reconciliation gaps. The product requirements remain in
[product-overview.md](../product-overview.md); the React Native frontend has not
been implemented in this work.

## Implemented behavior

- FastAPI owns phone/password accounts with Argon2id, expiring single-use codes,
  persisted limits/cooldowns and existence-neutral unauthenticated responses.
  PostgreSQL stores opaque-token hashes, access expiry, rotating refresh families
  and server-side revocation. Signup/verification, login, renewal, logout/all,
  current account, recovery/reset and reauthenticated verified phone changes are
  documented for mobile clients in [AUTHENTICATION.md](AUTHENTICATION.md).
- Upgrade SQL preserves account UUIDs/relationships without creating credentials
  or marking anyone verified. Legacy enrollment needs an expiring operator
  invitation and verification of the original stored recipient.
- Owner-only cancellation stops generated processes inside their container and
  keeps active protection through cleanup. Messaging has an atomic cancellation
  cutoff. Account-scoped idempotency keys prevent concurrent duplicate admission.
- Startup/sweeps inspect actual owned containers/processes, preserve active work,
  recover durable cleanup obligations and restore idle cleanup. Interrupted sends
  remain `delivery_unknown`; no automatic rerender/resend can duplicate a message.
- Independent actual-video evaluation retains structured checks/findings for the
  owner, with scope/render duration and optional audio/narration checks preserved.
- TypeScript uses the installed Spectrum 12.10.1 text builder for verification
  and consumes documented inbound DM read receipts. A metadata-only durable spool
  forwards signed private callbacks; duplicate/out-of-order/early events are safe
  and correlated by provider message ID plus captured send-time recipient.
- Renderer UID 1000 has kernel-enforced egress only through its account's trusted
  HTTPS allowlist proxy. Containers retain separate filesystems/PIDs, read-only
  roots, dropped capabilities, tmpfs, resource limits and no host/Docker mounts.
- Compose and the Cloudflare allowlist expose public auth/account/lesson routes
  while keeping database, Node endpoints, Docker control and callbacks private.
  Required production settings fail closed. The original request is appended
  at the bottom of the AI-generated section in [prompts.md](../prompts.md).

## Automated verification

The backend acceptance suite passed **71 tests with zero failures and zero
skips**. Messaging `npm run typecheck`, `npm run build` and `npm test` passed,
with **12 messaging tests**. The renderer, egress proxy, coordinator and messaging
images built successfully. Reproduce using [tests/README.md](tests/README.md).
Acceptance creates its own PostgreSQL 17
with tmpfs, resets only that disposable database, and requires zero skips.
Generated/hostile fixtures execute only inside isolated user containers. Tests
never read credential `.env` files, migrate production data, contact real Gemini
or GTTS, send Photon messages, provision DNS or run the mobile frontend.

The initial repository integration's 51-test evidence is historical. The current
run covers the additional authentication, migration, cancellation, idempotency,
receipt, recovery, egress and production-setting behavior. It includes real
PostgreSQL migrations and constraints, container process cancellation, temporary
artifact cleanup, egress rejection and Cloudflare route checks. These automated
results are the relevant verification for this version.

## Deferred live verification and provider limits

Live provider and full frontend-to-backend tests are deliberately deferred until
the frontend is ready. Synthetic silent audio/offline voiceover prove wiring
and stream presence; mocked Gemini verdicts do not prove real video/narration
quality. Actual Gemini/GTTS quality, required-host proxy connectivity, Photon
transport/recipient eligibility, mobile token storage and final production tunnel
DNS/TLS/client-address trust still need the later
[checklist](README.md#verification-and-later-integration).

Read receipts are a supported cloud iMessage capability, conditional on the
recipient enabling them and Photon resolving the upstream target. The installed
adapter exposes no delivery-only confirmation event; absent read evidence stays
`unconfirmed`. Photon acceptance never becomes inferred receipt. The provider
is iMessage transport, with no guaranteed universal SMS fallback; shared-line
plans may require recipient registration/allowlisting. These limitations are
explicit in [the provider contract evidence](../services/messaging/README.md#provider-contract-evidence).

Deployment requires the documented offline migrations for existing databases,
retirement of drained legacy unrestricted renderers, and new distinct auth/code,
receipt and messaging secrets. No production database or provider configuration
was changed by these automated checks.
