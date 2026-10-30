# Agent contract (optimized for agents, not humans)
STACK: Bun>=1.2 · TS strict · Bun.serve routes · Bun.sql (Postgres>=16, local) · zod v4 · React 19 + wouter + Tailwind v4 · OpenRouter Free Models Router · OpenAlex. No accounts, no Stripe, no Cloudflare Tunnel.
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
- Every query on user data has a `user_id = ${uid}` predicate, where uid is the single local user and never comes from the client.
- Every hot-path WHERE or ORDER BY is backed by an index. Every list query has a LIMIT. No N+1 queries: batch with `= ANY(${ids})`.
- Operations with more than one write go in `sql.begin()`.
SECURITY (MUST):
- Validate every body, query and param with zod `.strict()` at the route boundary.
- Mutating routes require Origin === APP_ORIGIN.
- Secrets come only from env.ts. Never log them or send them to the client.
- LLM: no tools or function calling. Model output is untrusted. Parse it with zod and render it without raw HTML.
- User or uploaded content sent to an LLM is wrapped in <user_data>…</user_data>, and the system prompt declares it as data, not instructions.
- Resources the caller doesn't own return 404, not 403.
TESTS: bun test. Write only the tests listed in a prompt. No network: mock with `mock.module`. DB tests use TEST_DATABASE_URL and truncate their tables.
DONE: `bun run typecheck && bun test` is green and the prompt's VERIFY passes.
MODULE MAP (append one line per module: path · purpose · key exports):
- src/server/http.ts · route wrapper, errors, free entitlement · route, HttpError, json, freeEntitlement, originAllowed
- src/server/rate.ts · token bucket · takeToken
- src/server/env.ts · validated env · env
- src/server/db.ts · shared Bun.sql pool · sql
- scripts/migrate.ts · checksummed migration runner (`bun run migrate [url]`) · none
- scripts/db-setup.sh · create role btg + DBs btg, btg_test · none
- src/server/local/{core,sql,routes}.ts · single local user, GET /api/me · localRoutes, LocalUser, ensureLocalUser, LOCAL_EMAIL
- src/server/testkit.ts · test env + test DB helpers (import statically, server modules dynamically after boot) · bootTestServer, createTestUser, createOtherUser, callRoute, TEST_ORIGIN
- src/server/llm/{models,core,sql,gateway,routes}.ts + src/shared/sse.ts · OpenRouter Free Models Router, reserve/settle usage, usage API · MODELS, SYSTEM_MODELS, chatJson, chatStream, refreshPricing, assertModelAllowed, reserveQuota, llmRoutes, parseSseChunk
- src/server/lit/{core,sql,openalex}.ts · OpenAlex grounding, 7-day cache, citation filtering · retrievePapers, buildSourcesBlock, filterCitations, toCitations, GROUNDING_RULES, normalizeQuery, abstractFromInverted
- src/shared/settings.ts · Settings schema with defaults, deep-partial patch, merge · Settings, SettingsPatch, mergeSettings
- src/shared/math.ts · wrap bare lesson LaTeX in $ delimiters before storage and render · wrapBareMath, MATH_DELIM_RULE
- src/server/learn/{core,sql,routes}.ts · SM-2, attempt pipeline, practice queue, settings routes · qualityOf, scheduleSm2, nextMastery, foldTopicStats, loadSettings, resolveModel, toQuestionPublic, insertCards, recordAttempt, learnRoutes
- src/server/topics/{core,sql}.ts · topic slugs, batched topic and edge upsert, lesson topic release · slugOf, upsertTopics, topicsReleasedByLesson
- src/server/gen/{core,sql,routes}.ts · standard and style-mimic question generation, strict-mode GenOut, count normalizer · genRoutes, GenOut, splitCounts, buildGenPrompt, normalizeQuestions, insertQuestions
- src/server/styles/{core,sql,routes}.ts · PDF/PNG style-profile uploads (magic bytes, profile only stored) · styleRoutes, sniffMime, acceptUpload, toFilePart
- src/server/teach/{core,sql,routes,prompts}.ts · grounded lessons, lazy steps with MCQ check, streamed Socratic chat, lesson delete · teachRoutes, StepOut, normalizePlan, normalizeStep, buildChatContext, TUTOR_RULES, deleteLessonData
- src/server/stats/{core,sql,routes}.ts · topic-independent metrics, knowledge graph, daily cached insights · computeMetrics, streakOf, statsRoutes
- src/shared/season.ts + src/server/season/routes.ts · northern-hemisphere season from the server clock, GET /api/season · Season, SeasonResponse, hemisphereOf, seasonOf, seasonRoutes
- src/web/{api,sse,session,router}.ts(x) · typed fetch (ApiError, describeError), SSE reader, local profile context (me/settings/season), wouter routes · api, streamSse, useSession, useMe, useSettings, useSeason, AppRouter
- src/web/theme.css + src/web/components/* · seasonal CSS variables keyed on <html data-season>, shell + UI primitives (AppShell, SeasonArt, Md, Panel, Button, Slider, Spinner, Logo, Placeholder) · Tailwind colours bg/panel/panel-2/border/text/muted/accent/accent-soft/accent-2/on-accent/danger
- src/web/pages/{Teach,Lesson,Practice}.tsx + src/web/components/{AskBar,QuestionCard,ConfidenceSlider,StepView,ChatPanel,Sources,UploadDrop,ErrorBanner,DeleteLessonButton}.tsx · teach canvas, lazy steps, streamed chat, practice queue, generation, style upload, lesson delete · AskBar, QuestionCard, StepView, StepSkeleton, ChatPanel, Sources, UploadDrop, ErrorBanner, ConfidenceSlider, DeleteLessonButton
