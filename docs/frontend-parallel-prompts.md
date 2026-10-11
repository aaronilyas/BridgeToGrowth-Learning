# Frontend implementation prompts

**Origin: AI-generated prompts extracted from the frontend implementation plan.**

Target: GPT-6 Luna, reasoning **high**, selected in the runner. These prompts request implementation, not more planning. Their structure uses direct goals, file ownership, and acceptance checks; this is a starting point rather than a claim of benchmarked optimization. See [the model](https://developers.openai.com/api/docs/models/gpt-6-luna) and [official prompting guidance](https://developers.openai.com/api/docs/guides/reasoning-best-practices).

## Run order

Run 1 and optional 2 concurrently in separate worktrees. Merge 1 into a shared baseline; merge 2 too if selected. Create branches 3–9 from that exact baseline and run them concurrently. Run 10 after their changes are committed. Separate branches require separate working directories to avoid concurrent filesystem edits. Do not launch all prompts from the original empty frontend checkout.

Prompt 2 and server-backed history/recovery are recommendations from the original plan, not confirmed product requirements. If omitted, 6 and 8 must document their limited recovery/history behavior. Legacy enrollment, web, push, biometrics, branding, and alternate messaging transports remain product decisions.

## Shared prefix — prepend to every task

```text
Implement only the task below in its named branch and separate worktree. Read agents.md, product-overview.md, backend/AUTHENTICATION.md, backend/README.md, and the baseline's frontend/PARALLEL_CONTRACTS.md if present. Treat current backend code/contracts as authoritative.

Use React Native, TypeScript, Expo, Expo Router, TanStack Query, built-in fetch, SecureStore, and native components/StyleSheet. Add only necessary dependencies. Preserve isolated user execution, temporary videos, per-user isolation, Node-only Photon, and backend-controlled idle shutdown with active-job protection.

Edit only your owned files; do not change shared contracts, package/lockfiles, root navigation, prompts.md, or another branch's files unless your task explicitly owns them. Use the baseline interfaces and injected adapters; do not wait for parallel branches or implement their features. Test with deterministic substitutes, never production auth bypasses or live provider calls. Report missing prerequisites and exact interface mismatches instead of inventing requirements.

Finish with focused checks and a commit containing only your task's changes. Report commit ID, checks, adapter exports, and deferred integration. Do not push, deploy, spawn agents, or alter other worktrees. Only task 10 may integrate other branches.
```

## 1 — Foundation: `frontend/foundation`

```text
Own frontend scaffolding/configuration, package/lockfiles, src/contracts/, src/components/, src/theme/, src/app/_layout.tsx, src/app/index.tsx, and frontend/PARALLEL_CONTRACTS.md. Do not implement feature flows.

Create a supported stable Expo TypeScript app with Expo Router, Query, SecureStore, connectivity support, Jest/React Native Testing Library, and minimal native prerequisites. Verify SDK compatibility from official docs; pin compatible versions. Provide scripts, an API-base-URL example, shared accessible form/verification/progress primitives, and a runnable placeholder entry.

Define typed account/token/challenge/job/error contracts matching the existing API. Publish frozen ApiClient, SessionController, app-lifecycle, secure-journal, and UI-services interfaces with method signatures and dependency injection. Supply a useServices hook and test provider; production defaults must fail explicitly until integration, never fake authentication. Include ports for secure idempotency-key creation and optional lesson list/key lookup; distinguish unsupported recovery from an empty result.

Document contracts and export paths so 3–9 can compile independently against the baseline. Keep feature route filenames uncreated. Verify installation, typecheck, lint, and test harness; report unavailable native build checks.
```

## 2 — Optional backend mobile contracts: `backend/mobile-contracts`

```text
Run only if owner-scoped history/recovery is chosen for launch. Own backend/main.py, collection-related additions in backend/service.py, new backend/mobile_schemas.py, backend/tests/test_mobile_contracts.py, and backend/MOBILE_COLLECTION.md. Preserve existing authentication/job behavior; do not alter database schema, rendering, messaging, or deployment configuration.

Add explicit response models for public account/token/challenge/job outputs, retaining current fields, nullability, and status codes; refresh has no account. Add authenticated paginated GET /lessons with bounded cursor pagination and optional exact idempotency_key filtering, always scoped to the bearer owner. Return {items, next_cursor}; each item includes the existing snapshot plus topic, voiceover, created_at, updated_at, and completed_at. Retain no videos.

Preserve no-store, authenticated activity, privacy, and read-receipt semantics. Test ownership, pagination, key isolation, output schemas, and existing /lessons tunnel coverage. Document exact parameters, limits, and schemas. Run focused checks and the required backend acceptance suite; report unavailable checks without claiming success.
```

## 3 — API client: `frontend/api-client`

```text
Own frontend/src/api/ and its colocated tests. Implement the baseline ApiClient with built-in fetch, injectable transport/session access, public HTTPS base URL, JSON/bearer handling, timeout/abort, and safe errors. Match all existing auth/account/lesson endpoints; expose optional collection/key lookup only when its real contract exists.

Handle 204, string/array detail, 422 fields, Retry-After/429, owner-private 404, and operation-specific 409. Refresh returns tokens without an account. Never log credentials or include provider secrets. Wait for session rotation before authenticated dispatch; invalidate stale session-generation responses through the baseline adapter.

Disable automatic mutation retries and offline replay. Permit bounded safe-read retries; lesson retries require an unchanged payload and existing idempotency key. Never blindly refresh on 401 or retry an uncertain refresh response. Test headers, errors, timeouts, stale sessions, and retry policies. Export the adapter without wiring root navigation/providers.
```

## 4 — Session manager: `frontend/session-manager`

```text
Own frontend/src/features/auth/session/ and its colocated tests. Implement the baseline SessionController using injected API, clock, SecureStore, and cache-reset adapters.

Keep access tokens in memory and persist only small refresh-session records. Respect 15-minute access expiry and absolute 30-day session expiry. Serialize refresh globally; pause authenticated dispatch, save rotated credentials before publishing them, and reject late results from old session generations. Restore on cold start/resume. Uncertain refresh, invalid-session 401, or secure-write failure requires clearing credentials and reauthentication; never replay a consumed token.

Clear caches/in-flight work on logout or account replacement. Attempt server logout/all before local clearing; distinguish local sign-out from unconfirmed server revocation. Reset/phone change requires renewed login. Test simultaneous refresh demand, lost responses, storage failures, expiry, account switching, and logout. Export the adapter; leave routes and root-provider wiring to integration.
```

## 5 — Authentication screens: `frontend/auth-screens`

```text
Own frontend/src/features/auth/screens/, its tests, and src/app/(auth)/ login, signup, verify, recovery, and reset routes. Use baseline API/session/UI interfaces; do not implement network transport or session storage.

Build login, signup→verification/resend, and recovery→reset. Validate E.164 phones, exact untrimmed 12–128-character passwords, and six-digit string codes preserving leading zeroes. Honor challenge expiry, resend cooldown, and Retry-After; resending never extends expiry or restores attempts. Use neutral verification copy without claiming a message was sent.

Install successful signup/login sessions; reset returns to login. Disable duplicate submissions, automatic retries, and offline mutation queues. Handle loading, field errors, expired/invalid codes, and connectivity. Use shared verification primitives, accessible labels, safe areas, keyboard handling, and dynamic type. Test leading-zero codes, resend timers, generic responses, reset behavior, and double taps with injected services. Defer legacy enrollment unless explicitly required.
```

## 6 — Lesson submission and recovery: `frontend/lesson-submission`

```text
Own frontend/src/features/lessons/submission/ and its colocated tests. Implement submission/recovery controllers through baseline API, secure-journal, and idempotency-key ports; do not build screens or polling.

Trim/validate a 1–10,000-character topic; voiceover defaults false. Send only {topic, voiceover}. Freeze the normalized payload and create one secure key per deliberate request; retries reuse both. Prevent double taps and automatic offline replay. Edited requests get new keys; delivery_unknown never triggers a fresh job automatically.

Before POST, persist a bounded account-scoped pending-key record. With the optional recovery API, reconcile lost responses by exact key; an empty lookup or unsupported endpoint never proves a new send is safe. Prune resolved entries and block cross-account recovery. Without that API, clearly limit recovery to retained UUIDs/in-memory payloads; flag any additional durable-payload storage requirement. Do not store full topics in SecureStore or persist Query caches. Test lost responses, restart, key reuse/conflicts, account switches, and unsupported recovery.
```

## 7 — Job polling and status rules: `frontend/job-polling`

```text
Own frontend/src/features/lessons/progress/ and its colocated tests. Implement Query hooks/controllers and pure status-to-UI rules using injected baseline API/session/lifecycle interfaces; do not build screens.

Support requested, queued, validating, generating, rendering, evaluating, delivering, needs_breakdown, failed, cancelled, interrupted, delivery_unknown, and accepted. Unknown status must never imply success. Separate cancel intent, terminal outcome, cleanup, acceptance, and read evidence.

Poll active/cleanup jobs every 3–5 seconds with bounded failure backoff. Stop intervals when backgrounded/offline; reconcile on foreground/reconnect after authentication. Stop fast polling at terminal status with cleanup_pending=false. For visible accepted jobs, use bounded receipt checks, initially every 15 seconds for at most two minutes, plus manual refresh. Missing receipts stay unconfirmed. Disable cancel at messaging cutoff; refetch after cancel 409. Scope keys by owner. Test lifecycle timers, terminal cleanup, cancellation races, and acceptance/read distinctions; prevent indefinite container keepalive.
```

## 8 — Lesson screens: `frontend/lesson-screens`

```text
Own frontend/src/features/lessons/screens/, its tests, and src/app/(signed-in)/index.tsx and lessons/[id].tsx. Add a history route only if the optional collection API is included. Use injected baseline submission/progress services; do not implement their controllers.

Build composer→job detail with verified recipient display, multiline topic, and narration off by default. Explain the 90-second video limit without promising generation time. Show stage text and indeterminate progress, scope feedback with edit/resubmit, safe failures/evaluation findings, pending cancellation/cleanup, and interruption.

For accepted/unconfirmed say accepted for sending, receipt unconfirmed; only receipt_status=read confirms read_at. For delivery_unknown explain possible prior sending and offer no automatic resend. Show stale/offline state honestly. Use accessible native components, keyboard/safe-area handling, and shared styles; omit video playback because no download API exists. Test outcomes and interactions with injected adapters, including unknown statuses, duplicate submit protection, and cancellation cutoff.
```

## 9 — Account screens: `frontend/account-screens`

```text
Own frontend/src/features/account/, its tests, and src/app/(signed-in)/account.tsx, change-phone.tsx, and verify-phone.tsx. Use baseline API/session interfaces and shared verification primitives; do not edit authentication screens or implement session storage.

Show the server-derived account phone/verification state. Implement logout and logout-all with accurate revocation feedback. Build current-password reauthentication→new-phone challenge→verification/resend. Successful phone verification revokes sessions: clear local state and require login with the new number. Explain that an already-started message may reach the old phone.

Honor E.164, untrimmed passwords, leading-zero codes, challenge expiry/cooldown, and Retry-After. Never display account UUID/provider internals unnecessarily. Handle loading, validation, offline, and stale-session states accessibly. Test revocation, cancelled/failed phone changes, resend timing, session invalidation, and clearing previous-account information. Do not add unsupported profile editing, account deletion, or biometric requirements.
```

## 10 — Integration and verification: `frontend/integration`

```text
Start after 3–9 are committed. Integrate their exact reported commits into a separate integration worktree based on the shared baseline; preserve unrelated changes and source branches. Own root providers/navigation, frontend/PARALLEL_CONTRACTS.md, necessary interface/package fixes, integration tests, and frontend/README.md. Modify leaf modules only to resolve demonstrated integration failures.

Wire API↔session adapters, Query, SecureStore/journal, connectivity/AppState, and feature services. Gate signed-in routes until restoration completes. Eliminate placeholder production providers. Align optional collection types with backend/MOBILE_COLLECTION.md; if absent, document limited history/recovery without inventing endpoints. Review credentials/backup behavior, idempotency, stale responses, logout/cache clearing, and paused polling.

Run install/typecheck/lint/tests and native development builds where available. Add meaningful cross-feature tests for signup→lesson, lost POST/refresh responses, cancellation cutoff, restart/offline resume, and receipts. Run required backend checks if backend changed. Record blocked checks accurately. Document staging HTTPS/TLS/cache/address-trust setup, controlled live Gemini/GTTS/Photon testing, iOS/Android device checks, and iMessage recipient/allowlist limitations. Do not claim universal Android delivery or introduce alternate transport, push, web, enrollment, or biometric scope. Do not push/deploy or send live messages during this task.
```
