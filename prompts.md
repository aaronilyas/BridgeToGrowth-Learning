# Prompt history

This file combines the former `prompt.md` and `prompts.md`. Prompt text is preserved as historical instructions; references to the former filename remain as originally written.

Origin labels describe prompt authorship, not whether AI carried out the task. **AI-generated** means the original entry explicitly identified itself that way. **Not marked AI-generated — authorship unverified** means the original entry had no AI-generation label; this does not establish that it was written without AI. No entry currently has a verified non-AI authorship label. For future entries, record **Human-written (not AI-generated)**, **AI-generated**, or **AI-assisted** when the origin is known.

## Original prompts without an AI-generation label

### Backend schema and PostgreSQL setup

**Origin: Not marked AI-generated — authorship unverified.**

Create a backend sub directory then Based on the agents.md as well as the product-overview.md design a sqlalchemy data base schema and install Postgres's sql. After that create a prompt.md file outside of the backend sub directory and append this prompt to it.

Create an PostgreSQL database and establish a connection to it, assume the database will be reset after testing

### Backend acceptance test suite

**Origin: Not marked AI-generated — authorship unverified.**

Analyze the contents of the Agents.md as well as the Product-overview.md and based on their contents design a compact but effective language agnostic test suite for the fast api portion of this apps backend all the functionality that must be baked into it. Then once you are done append this prompt to the prompts.md 

Place the test suite in a sub directory within the backend sub directory.

### Messaging scaffold and repository organization

**Origin: Not marked AI-generated — authorship unverified.**

Analyze the current state of the repo and then run this command bun create spectrum-project@latest bridgetogrowth-learning --projectId a96c8fdb-17f1-4c49-94f6-3ec6e12f565e --providers imessage --yes

If a sub directory is created extract the contents from it and organize it in the way you see best fit for the product this repo is trying to build. 

Then append this prompt to the prompts.md

### FastAPI backend implementation

**Origin: Not marked AI-generated — authorship unverified.**

Based on the product-overview.md, agents.md and the existing test suite implement the fastapi portion of the products backend, keep the number of routes to a minimum and keep design as simple as possible, so that it can be easily explained to a human at a high level. Then append this prompt to the prompts.md once you are done.

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

## Additional instruction without an AI-generation label

### Allowed technologies

**Origin: Not marked AI-generated — authorship unverified.**

You may download different technologies so long as they from the allowed list outlined in the product overview markdown file.
