# Prompts

Analyze the contents of the Agents.md as well as the Product-overview.md and based on their contents design a compact but effective language agnostic test suite for the fast api portion of this apps backend all the functionality that must be baked into it. Then once you are done append this prompt to the prompts.md 

Place the test suite in a sub directory within the backend sub directory.


Analyze the current state of the repo and then run this command bun create spectrum-project@latest bridgetogrowth-learning --projectId a96c8fdb-17f1-4c49-94f6-3ec6e12f565e --providers imessage --yes

If a sub directory is created extract the contents from it and organize it in the way you see best fit for the product this repo is trying to build. 

Then append this prompt to the prompts.md

Based on the product-overview.md, agents.md and the existing test suite implement the fastapi portion of the products backend, keep the number of routes to a minimum and keep design as simple as possible, so that it can be easily explained to a human at a high level. Then append this prompt to the prompts.md once you are done.

## AI-generated implementation prompt

Implement the authenticated HTTP delivery endpoint in `services/messaging` matching `integrations.py`: accept temporary MP4 bytes, validate the shared token, route to the specified recipient, and send through Photon. Return acceptance and a provider message ID only after Photon accepts. Keep SDK calls in TypeScript and retain no video files. Test authorization, rejection, and acceptance. Append this prompt to `prompts.md`, explicitly labeling it “AI-generated implementation prompt” to distinguish it from previous entries.

## AI-generated implementation prompt

Work in a dedicated worktree on branch `backend/compose-setup`. Own `compose.yaml`, dedicated deployment Dockerfiles, a deployment environment example, and `compose.md`. Configure PostgreSQL, one FastAPI coordinator, and the completed messaging service using its existing runtime and endpoint contract. Preserve isolated user containers, temporary video storage, and lifecycle protections. Keep Docker control access confined to the coordinator. Do not modify application code, messaging package files, renderer files, or tunnel configuration. Append this exact prompt to this worktree’s `prompts.md`, labeled “AI-generated implementation prompt” to distinguish it from previous entries.

## AI-generated implementation prompt

Work in a dedicated worktree on branch `backend/account-onboarding`. Own authentication-related changes in `main.py`, a new `auth.py`, and dedicated authentication tests and documentation. Complete onboarding integration using the configured identity provider while preserving `/account` and the existing authenticated identity contract. If provider selection is missing, document that blocker rather than inventing a credential system. Do not change job orchestration, database models, messaging, or deployment files. Append this exact prompt to this worktree’s `prompts.md`, labeled “AI-generated implementation prompt” to distinguish it from previous entries.

## AI-generated implementation prompt

Work in a dedicated worktree on branch `backend/delivery-semantics`. Own delivery-status changes in `service.py`, `models.py`, `schema.sql`, any required migration, and dedicated tests and documentation. Preserve the completed Photon endpoint contract. Align internal completion terminology with confirmed Photon acceptance and preserve public polling behavior. Document confirmed user receipt as unresolved unless existing requirements and provider capabilities establish a supported mechanism; do not invent receipt callbacks. Do not change authentication, rendering, messaging, or deployment files. Append this exact prompt to this worktree’s `prompts.md`, labeled “AI-generated implementation prompt” to distinguish it from previous entries.

## AI-generated implementation prompt

Work in a dedicated worktree on branch `backend/voiceover-verification`. Own changes in `worker.py` and dedicated voiceover tests and documentation. Verify an audio stream exists when voiceover is requested, rejecting missing audio before delivery; do not claim this alone proves narration quality. Preserve rendering when voiceover is disabled and the existing 90-second limit. Run generated code and rendering fixtures only inside isolated user containers. Do not change API, orchestration, database, messaging, or deployment files. Append this exact prompt to this worktree’s `prompts.md`, labeled “AI-generated implementation prompt” to distinguish it from previous entries.

## AI-generated implementation prompt

Work in a dedicated worktree on branch `backend/cloudflare-tunnel`. Own only `deploy/cloudflare/` and `cloudflare.md`. Provide standalone tunnel configuration and startup instructions targeting a configurable API origin, without depending on the parallel Compose task. Keep database, Docker control, and messaging endpoints private. Supply credential and domain placeholders without inventing production values. Do not modify Compose or application files. Append this exact prompt to this worktree’s `prompts.md`, labeled "AI-generated implementation prompt" to distinguish it from previous entries.

## AI-generated implementation prompt

Work in a dedicated worktree on branch `backend/node-runtime`. Own messaging package, lockfile, TypeScript configuration, runtime compatibility changes, and `node-runtime.md`. Align the completed messaging service with Node.js while preserving its HTTP interface, authentication, Photon acceptance behavior, and temporary-video handling. Verify compilation and startup; flag SDK incompatibilities. Do not modify Python, deployment files, or shared READMEs. Append this exact prompt to this worktree’s `prompts.md`, labeled “AI-generated implementation prompt” to distinguish it from previous entries.
