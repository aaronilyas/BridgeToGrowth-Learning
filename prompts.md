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
