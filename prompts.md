# Prompt history

This file combines the former `prompt.md` and `prompts.md`. Prompt text is preserved as historical instructions; references to the former filename remain as originally written.

Origin labels describe prompt authorship, not whether AI carried out the task. **Human-written (not AI-generated)** identifies the original requests and additional instruction that Aaron confirmed he wrote. **AI-generated** identifies entries explicitly labeled that way in the original history. For future entries, record **Human-written (not AI-generated)**, **AI-generated**, or **AI-assisted** when the origin is known.

## Human-written prompts (not AI-generated)

### Backend schema and PostgreSQL setup

**Origin: Human-written (not AI-generated).**

Create a backend sub directory then Based on the agents.md as well as the product-overview.md design a sqlalchemy data base schema and install Postgres's sql. After that create a prompt.md file outside of the backend sub directory and append this prompt to it.

Create an PostgreSQL database and establish a connection to it, assume the database will be reset after testing

### Backend acceptance test suite

**Origin: Human-written (not AI-generated).**

Analyze the contents of the Agents.md as well as the Product-overview.md and based on their contents design a compact but effective language agnostic test suite for the fast api portion of this apps backend all the functionality that must be baked into it. Then once you are done append this prompt to the prompts.md 

Place the test suite in a sub directory within the backend sub directory.

### Messaging scaffold and repository organization

**Origin: Human-written (not AI-generated).**

Analyze the current state of the repo and then run this command bun create spectrum-project@latest bridgetogrowth-learning --projectId a96c8fdb-17f1-4c49-94f6-3ec6e12f565e --providers imessage --yes

If a sub directory is created extract the contents from it and organize it in the way you see best fit for the product this repo is trying to build. 

Then append this prompt to the prompts.md

### FastAPI backend implementation

**Origin: Human-written (not AI-generated).**

Based on the product-overview.md, agents.md and the existing test suite implement the fastapi portion of the products backend, keep the number of routes to a minimum and keep design as simple as possible, so that it can be easily explained to a human at a high level. Then append this prompt to the prompts.md once you are done.

### Cross-platform mobile frontend approach

**Origin: Human-written (not AI-generated).**

Analyze the backend sub directory as well as the product-overview.md and determine the best approach to implement the front end for the cross platform mobile app, using the tech stack outlined in the product-overview.md and following the guidelines of the agents.md.

### Parallel frontend implementation prompts

**Origin: Human-written (not AI-generated).**

Extract the contents of the front-implementation-plan.md and provide them to me as concise narrowly scoped prompts optimized for GPT 6 luna on high reasoning that can run in parallel, in separate branches. After doing this delete the front-implementation-plan.md.

Append this prompt to prompts.md in the human written prompts section

## AI-generated prompts

### Photon HTTP delivery endpoint

**Origin: AI-generated implementation prompt.**

Implement the authenticated HTTP delivery endpoint in `services/messaging` matching `integrations.py`: accept temporary MP4 bytes, validate the shared token, route to the specified recipient, and send through Photon. Return acceptance and a provider message ID only after Photon accepts. Keep SDK calls in TypeScript and retain no video files. Test authorization, rejection, and acceptance. Append this prompt to `prompts.md`, explicitly labeling it “AI-generated implementation prompt” to distinguish it from previous entries.

### Compose deployment

**Origin: AI-generated implementation prompt.**

Work in a dedicated worktree on branch `backend/compose-setup`. Own `compose.yaml`, dedicated deployment Dockerfiles, a deployment environment example, and `compose.md`. Configure PostgreSQL, one FastAPI coordinator, and the completed messaging service using its existing runtime and endpoint contract. Preserve isolated user containers, temporary video storage, and lifecycle protections. Keep Docker control access confined to the coordinator. Do not modify application code, messaging package files, renderer files, or tunnel configuration. Append this exact prompt to this worktree’s `prompts.md`, labeled “AI-generated implementation prompt” to distinguish it from previous entries.

### Account onboarding

**Origin: AI-generated implementation prompt.**

Work in a dedicated worktree on branch `backend/account-onboarding`. Own authentication-related changes in `main.py`, a new `auth.py`, and dedicated authentication tests and documentation. Complete onboarding integration using the configured identity provider while preserving `/account` and the existing authenticated identity contract. If provider selection is missing, document that blocker rather than inventing a credential system. Do not change job orchestration, database models, messaging, or deployment files. Append this exact prompt to this worktree’s `prompts.md`, labeled “AI-generated implementation prompt” to distinguish it from previous entries.

### Delivery acceptance semantics

**Origin: AI-generated implementation prompt.**

Work in a dedicated worktree on branch `backend/delivery-semantics`. Own delivery-status changes in `service.py`, `models.py`, `schema.sql`, any required migration, and dedicated tests and documentation. Preserve the completed Photon endpoint contract. Align internal completion terminology with confirmed Photon acceptance and preserve public polling behavior. Document confirmed user receipt as unresolved unless existing requirements and provider capabilities establish a supported mechanism; do not invent receipt callbacks. Do not change authentication, rendering, messaging, or deployment files. Append this exact prompt to this worktree’s `prompts.md`, labeled “AI-generated implementation prompt” to distinguish it from previous entries.

### Voiceover verification

**Origin: AI-generated implementation prompt.**

Work in a dedicated worktree on branch `backend/voiceover-verification`. Own changes in `worker.py` and dedicated voiceover tests and documentation. Verify an audio stream exists when voiceover is requested, rejecting missing audio before delivery; do not claim this alone proves narration quality. Preserve rendering when voiceover is disabled and the existing 90-second limit. Run generated code and rendering fixtures only inside isolated user containers. Do not change API, orchestration, database, messaging, or deployment files. Append this exact prompt to this worktree’s `prompts.md`, labeled “AI-generated implementation prompt” to distinguish it from previous entries.

### Cloudflare tunnel

**Origin: AI-generated implementation prompt.**

Work in a dedicated worktree on branch `backend/cloudflare-tunnel`. Own only `deploy/cloudflare/` and `cloudflare.md`. Provide standalone tunnel configuration and startup instructions targeting a configurable API origin, without depending on the parallel Compose task. Keep database, Docker control, and messaging endpoints private. Supply credential and domain placeholders without inventing production values. Do not modify Compose or application files. Append this exact prompt to this worktree’s `prompts.md`, labeled "AI-generated implementation prompt" to distinguish it from previous entries.

### Node.js messaging runtime

**Origin: AI-generated implementation prompt.**

Work in a dedicated worktree on branch `backend/node-runtime`. Own messaging package, lockfile, TypeScript configuration, runtime compatibility changes, and `node-runtime.md`. Align the completed messaging service with Node.js while preserving its HTTP interface, authentication, Photon acceptance behavior, and temporary-video handling. Verify compilation and startup; flag SDK incompatibilities. Do not modify Python, deployment files, or shared READMEs. Append this exact prompt to this worktree’s `prompts.md`, labeled “AI-generated implementation prompt” to distinguish it from previous entries.

### Backend integration and verification

**Origin: AI-generated integration prompt.**

The following prompt is AI-generated, distinguished from previous entries.

AI-generated integration prompt

Integrate the completed backend work into main and push the verified result to GitHub.

Create a dedicated integration branch and worktree from freshly fetched origin/main. Inventory these branches and their associated worktrees:
- backend/account-onboarding
- backend/delivery-semantics
- backend/voiceover-verification
- backend/compose-setup
- backend/cloudflare-tunnel
- backend/node-runtime

Most implementations currently exist as uncommitted tracked and untracked worktree changes; merging branch tips alone would omit them. Review and preserve all intended changes, commit them on their respective branches once their work is complete, and merge them into the integration branch. Do not discard unrelated edits, modify worktrees with active writers, or delete source branches/worktrees.

Resolve conflicts by preserving each feature’s behavior and every distinct prompts.md entry. Reconcile overlapping backend README and test documentation changes.

Fix integration issues before pushing:
1. Replace Compose’s Bun image, bun.lock references, startup command, healthcheck command, and build-context allowlist with the Node implementation. Compile TypeScript during the image build, install production dependencies using package-lock.json, and run emitted JavaScript.
2. Update stale Bun/echo-scaffold instructions in repository and messaging documentation to match the implemented Node Photon endpoint.
3. Keep acceptance distinct from confirmed receipt. Verify atomic job/delivery acceptance, terminal-state handling, polling, and inactive-container cleanup.
4. Validate the delivery-status migration against disposable PostgreSQL, including legacy acceptance evidence. Document migration requirements for existing Compose volumes; do not apply migrations to live databases.
5. Verify voiceover validation works through the complete pipeline. Audio-stream presence must not be described as proof of narration quality.
6. Remove tracked Python bytecode and retain appropriate ignore rules.
7. Ensure the Cloudflare setup reaches the loopback-bound Compose API while exposing no messaging, database, or Docker-control endpoint.
8. Locate any subsequently completed architecture-acceptance work. If none exists, implement the missing executable acceptance checks needed to verify isolation, lifecycle behavior, cleanup, and the real messaging HTTP boundary with substituted Photon responses.

Make additional focused fixes for failures found during integration. Preserve isolated user execution, temporary video storage, per-user file isolation, Photon SDK placement in TypeScript, the single coordinator, and the 25-minute authenticated inactivity policy. Never stop containers with active jobs. Do not invent an identity provider or receipt mechanism; document unresolved product decisions accurately.

Run the combined Python suite, messaging npm ci/typecheck/build/tests, fresh-schema and migration PostgreSQL checks, Compose validation and image builds, real disposable-container acceptance checks, and Cloudflare ingress checks using synthetic configuration. Never run generated fixtures on the host, read or commit credential .env files, or send real messages. Report unavailable checks as blocked, never passed; do not push while required verification is unresolved.

Once required checks pass, fetch origin again, incorporate any new main changes, and rerun affected checks. Fast-forward local main to the verified integration result without overwriting unrelated work, then push main to origin without force-pushing. If branch protection requires a PR, create and link it, follow the required checks, and merge through the permitted workflow. Verify origin/main contains the final commits and report the commit ID, fixes, test results, and remaining documented product blockers.

Append this exact prompt to prompts.md under “AI-generated integration prompt,” explicitly identifying it as AI-generated to distinguish it from previous entries, and include that addition in the final commit.

### Remaining backend implementation

**Origin: User-supplied implementation prompt, appended to the AI-generated prompts section as requested.**

Implement the remaining and partially implemented backend functionality for BridgeToGrowth-Learning.

Read product-overview.md, agents.md, backend/, services/messaging/, compose.yaml, and the deployment documentation first. Treat product-overview.md as the requirements source.

The app must manage its own authentication and accounts. Remove the dependency on an external identity provider and AUTH_INTROSPECTION_URL.

Scope
- Implement backend functionality and update its tests, migrations, configuration, and documentation.
- Do not build the React Native frontend; that will be handled separately.
- Run automated backend and messaging tests now.
- Defer live provider testing and full frontend-to-backend testing until the frontend is ready. Clearly distinguish implemented behavior, automated verification, and deferred live verification.
- Preserve existing working functionality and follow the repository’s architectural constraints.

1. Implement backend-owned authentication

Use phone number and password authentication, with phone verification because the phone number is the lesson-delivery recipient.

Provide a complete API flow for:
- Signup and phone verification.
- Login.
- Session renewal.
- Logout and revocation of all sessions.
- Retrieving the current account.
- Password recovery and reset.
- Changing the phone number after verifying the new recipient and reauthenticating the account.

Use a maintained password-hashing library with Argon2id. Never store plaintext passwords, session tokens, refresh tokens, or verification codes.

Use cryptographically random opaque bearer tokens backed by PostgreSQL:
- Short-lived access tokens.
- Expiring refresh tokens with rotation and reuse detection.
- Server-side revocation.
- Revocation after password reset and account security changes.

Implement expiring, single-use verification codes with bounded attempts, resend cooldowns, and rate limits for authentication and recovery operations. Avoid exposing account existence through unauthenticated responses or logging credentials and codes.

Keep identity and lesson recipients server-derived. Preserve ownership checks and ensure unauthenticated requests do not refresh container activity.

Preserve existing account UUIDs and relationships through a documented migration. Existing users must not receive fabricated credentials or automatically become verified under the new authentication system. Define a safe enrollment path.

Verification-message delivery must remain behind the Node/TypeScript service. Confirm the installed Photon Spectrum SDK’s supported text-message contract before implementing the adapter. Authentication and account state belong to this backend; Photon is only the message transport. Use deterministic substitutes in tests, never a production verification bypass.

2. Complete delivery-status handling

Preserve the distinction between Photon acceptance and confirmed receipt.

Inspect the installed SDK and official provider documentation for supported delivery or receipt events. If a supported mechanism exists:
- Implement the appropriate authenticated callback or event consumer.
- Correlate provider events with the correct lesson and account.
- Handle duplicate and out-of-order events safely.
- Persist and expose the supported receipt state through polling.
- Reject forged events and prevent cross-account disclosure.

Never infer receipt from acceptance, elapsed time, or a successful HTTP response.

If the provider cannot support receipt confirmation, retain the accurate accepted status and document the precise remaining limitation. Complete all independent work and report the unsupported capability explicitly.

3. Implement safe crash recovery

Replace reliance on manual reconciliation wherever the backend can safely determine what happened.

On coordinator startup:
- Reconcile persisted jobs with actual user-container and process state.
- Preserve genuinely active work.
- Clean abandoned temporary artifacts once work has stopped.
- Mark interrupted jobs with an accurate terminal outcome when safe.
- Restore inactivity cleanup eligibility.
- Recover outstanding cleanup obligations from persisted metadata.

Do not automatically resend a video when a previous send may already have been accepted. Expose an accurate outcome when acceptance cannot be established.

Maintain the single-coordinator guard and atomic admission/shutdown protection.

4. Complete cancellation and duplicate-request handling

Implement authenticated lesson cancellation:
- Only the owner may cancel.
- Stop generated processes safely within the owning container.
- Remove temporary artifacts before releasing active-job protection.
- Handle cancellation racing with rendering, evaluation, delivery, and completion.
- Clearly define behavior once messaging has started; do not claim to retract an accepted message.

Support idempotency keys for lesson submission:
- Repeating the same key and request returns the existing job.
- Reusing the key with different request content returns a conflict.
- Scope keys to the authenticated account.
- Prevent duplicate jobs under concurrent submissions.
- Do not claim provider-side send deduplication unless the provider supports it.

5. Finish generation and evaluation integration

Preserve:
- Gemini code generation inside isolated user containers.
- Manim rendering only inside those containers.
- Scope feedback for lessons estimated over 90 seconds.
- Actual rendered-duration enforcement.
- Optional Manim Voiceover audio checks.
- A fresh, independent Gemini evaluation of the actual video.
- Accuracy, visual-defect, consistency, and requested-narration checks before delivery.

Persist useful structured evaluation findings as metadata and expose appropriate feedback to the owning account. Do not persist generated videos.

Validate configuration and malformed provider responses. Keep failures observable without exposing secrets or internal implementation details.

Do not treat synthetic audio or mocked Gemini responses as proof of real narration quality.

6. Complete deployment configuration and container egress controls

Update Compose and Cloudflare configuration for the new public account and authentication routes. Keep PostgreSQL, messaging endpoints, Docker control, and internal callbacks private except where a supported authenticated provider callback explicitly needs exposure.

Implement and document enforceable renderer egress restrictions while allowing the external services required for Gemini generation and voiceover. Preserve per-user network/filesystem isolation and prevent access to private control services.

Provide configuration examples without credentials. Production startup must fail clearly when required settings are missing.

7. Verification and handoff

Add meaningful tests for:
- Signup, verification, login, expiry, refresh rotation, logout, recovery, and phone changes.
- Authentication throttling and invalid/replayed verification codes.
- Migration and existing-account enrollment.
- Account ownership and authenticated activity.
- Cancellation races.
- Concurrent idempotent submission.
- Startup reconciliation and cleanup recovery.
- Supported receipt events, including duplicates and forged events.
- Container isolation, egress controls, and temporary-video cleanup.

Run the existing backend acceptance suite, appropriate new tests, and messaging typecheck/build/tests. Generated code and hostile fixtures must execute only in isolated user containers.

Update backend documentation with:
- Exact endpoint request/response contracts for the future frontend.
- Authentication and token-storage expectations for a mobile client.
- Database migration and deployment instructions.
- Terminal job statuses and their precise meanings.
- Any remaining unsupported provider capabilities.
- A checklist for later live integration and frontend testing.

Proceed with implementation, using these defaults for routine decisions. Do not stop after writing a plan. At completion, summarize what changed, what passed, and what still requires live testing or an external capability.
Append this prompt to the prompts.md file at the bottom of the ai generated prompts section

## Human-written additional instruction (not AI-generated)

### Allowed technologies

**Origin: Human-written (not AI-generated).**

You may download different technologies so long as they from the allowed list outlined in the product overview markdown file.
