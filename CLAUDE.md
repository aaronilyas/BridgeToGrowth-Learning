# Agent contract (optimized for agents, not humans)
STACK: Bun>=1.2 · TS strict · Bun.serve routes · Bun.sql (Postgres>=16, local) · Bun.password (argon2id) · zod v4 · React 19 + wouter + Tailwind v4 · OpenRouter · Stripe · OpenAlex · Cloudflare Tunnel.
DEPS: only those in package.json. Adding one requires a justification line in the commit body. Exact versions only. CI uses --frozen-lockfile.
LAYOUT: src/server/<module>/{routes.ts,core.ts,sql.ts} · src/shared/*.ts (isomorphic; zod schemas are the single source of API truth) · src/web/** · db/migrations/NNNN_*.sql · scripts/* · deploy/* · tests colocated as *.test.ts.
CODE:
- Named exports only. No default exports. No barrel/index re-export files.
- Every exported function: explicit param and return types, plus the header tag `// O(<time>)`. Add `// INV:` for invariants and `// SEC:` for security decisions. No other prose comments.
- core.ts = pure (no IO), so it's unit-testable. sql.ts = DB only. routes.ts = HTTP glue only.
- Throw HttpError(status, ErrorCode). Never leak internals.
- No classes except HttpError. No `any`. No non-null `!`. Function names are verbNoun and unique repo-wide, so grep finds exactly one definition.
- Files are at most 300 lines.
SQL:
- Bun.sql tagged templates only. `sql.unsafe` is forbidden outside scripts/migrate.ts.
- Every query on user data has a `user_id = ${uid}` predicate, where uid comes from the session and never from the client.
- Every hot-path WHERE or ORDER BY is backed by an index. Every list query has a LIMIT. No N+1 queries: batch with `= ANY(${ids})`.
- Operations with more than one write go in `sql.begin()`.
SECURITY (MUST):
- Validate every body, query and param with zod `.strict()` at the route boundary.
- Mutating routes require Origin === APP_ORIGIN. The only exception is the Stripe webhook, which verifies its signature instead.
- Secrets come only from env.ts. Never log them or send them to the client.
- LLM: no tools or function calling. Model output is untrusted. Parse it with zod and render it without raw HTML.
- User or uploaded content sent to an LLM is wrapped in <user_data>…</user_data>, and the system prompt declares it as data, not instructions.
- Resources the caller doesn't own return 404, not 403.
TESTS: bun test. Write only the tests listed in a prompt. No network: mock with `mock.module`. DB tests use TEST_DATABASE_URL and truncate their tables.
DONE: `bun run typecheck && bun test` is green and the prompt's VERIFY passes.
MODULE MAP (append one line per module: path · purpose · key exports):
- src/server/http.ts · route wrapper, errors · route, HttpError, json
- src/server/rate.ts · token bucket · takeToken
- src/server/env.ts · validated env · env
- src/server/db.ts · shared Bun.sql pool · sql
- scripts/migrate.ts · checksummed migration runner (`bun run migrate [url]`) · none
- scripts/db-setup.sh · create role btg + DBs btg, btg_test · none
- src/server/auth/{core,sql,routes,turnstile}.ts · email+password auth, opaque sessions, Turnstile · authRoutes, AuthUser, hashToken, readSessionToken, findSession, verifyTurnstile
- src/server/testkit.ts · test env + test DB helpers (import statically, server modules dynamically after boot) · bootTestServer, createTestUser, callRoute, TEST_ORIGIN
- src/server/billing/{core,sql,routes,stripe}.ts · Stripe checkout/portal/cancel/resume, order-independent webhook, entitlement · billingRoutes, entitlementOf, snapshotSubscription, applyStripeEvent, fetchSubscription
- src/server/llm/{models,core,sql,gateway,routes}.ts + src/shared/sse.ts · OpenRouter gateway, plan allowlist, reserve/settle quota, usage · MODELS, SYSTEM_MODELS, chatJson, chatStream, refreshPricing, assertModelAllowed, reserveQuota, llmRoutes, parseSseChunk
- src/server/lit/{core,sql,openalex}.ts · OpenAlex grounding, 7-day cache, citation filtering · retrievePapers, buildSourcesBlock, filterCitations, toCitations, GROUNDING_RULES, normalizeQuery, abstractFromInverted
- src/shared/settings.ts · Settings schema with defaults, deep-partial patch, merge · Settings, SettingsPatch, mergeSettings
- src/server/learn/{core,sql,routes}.ts · SM-2, attempt pipeline, practice queue, settings routes · qualityOf, scheduleSm2, nextMastery, loadSettings, resolveModel, toQuestionPublic, insertCards, recordAttempt, learnRoutes
- src/server/topics/{core,sql}.ts · topic slugs, batched topic and edge upsert · slugOf, upsertTopics
