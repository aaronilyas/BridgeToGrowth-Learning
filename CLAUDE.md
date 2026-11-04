# Agent contract (optimized for agents, not humans)
PRODUCT: a single-user desktop app. No accounts, plans, billing or server deployment. The user connects their own AI sources: OpenRouter (API key), Codex (ChatGPT subscription via the official Codex CLI), SpaceXAI (API key). Every feature is available to everyone.
STACK: Bun>=1.4 · TS strict · Bun.serve routes · Bun.SQL on SQLite (WAL, foreign_keys=ON) · Bun.secrets (OS keychain) · zod v4 · React 19 + wouter + Tailwind v4 · Electrobun 2 shell (system webview) · Pyodide in a Web Worker for Python exercises · unpdf for PDF text · OpenAlex · fflate for the data export.
FACTS: docs/desktop-facts.md is the verified source for Codex CLI flags and events, the SpaceXAI endpoint, and the platform choices. Re-verify against the installed binaries before changing a provider adapter.
DEPS: only those in package.json. Adding one requires a justification line in the commit body. Exact versions only. CI uses --frozen-lockfile.
LAYOUT: src/server/<module>/{routes.ts,core.ts,sql.ts} · src/server/llm/providers/* (one adapter per provider) · src/shared/*.ts (isomorphic; zod schemas are the single source of API truth) · src/web/** · db/migrations/NNNN_*.sql (SQLite, append-only: the runner rejects a changed checksum) · desktop/* (Electrobun main + config) · scripts/* · tests colocated as *.test.ts.
CODE:
- Named exports only. No default exports. No barrel/index re-export files.
- Every exported function: explicit param and return types, plus the header tag `// O(<time>)`. Add `// INV:` for invariants and `// SEC:` for security decisions. No other prose comments.
- core.ts = pure (no IO), so it's unit-testable. sql.ts = DB only. routes.ts = HTTP glue only.
- Throw HttpError(status, ErrorCode). Never leak internals.
- No classes except HttpError. A provider adapter is a record of functions. No `any`. No non-null `!`. Function names are verbNoun and unique repo-wide, so grep finds exactly one definition.
- Files are at most 300 lines.
SQL:
- Bun.SQL tagged templates only. `sql.unsafe` is forbidden outside scripts/migrate.ts.
- One local profile (src/server/profile.ts). `user_id` columns remain and always hold LOCAL_USER_ID; there is no per-request user, so no per-query ownership predicate is required.
- Instants are INTEGER epoch ms; calendar days are 'YYYY-MM-DD' TEXT; JSON is TEXT. Convert at the sql.ts boundary (src/server/sqlmap.ts) so callers see Date, objects and booleans.
- Every hot-path WHERE or ORDER BY is backed by an index. Every list query has a LIMIT. No N+1 queries: batch with `IN ${sql(ids)}` (guard empty lists).
- Operations with more than one write go in `sql.begin()`.
SECURITY (MUST):
- The backend binds 127.0.0.1 on a random port. src/server/localGuard.ts rejects any Host other than 127.0.0.1:<port> (421), any /api request without the per-launch 256-bit token in `x-btg-token` (401, constant-time compare), any mutation or WebSocket upgrade whose Origin is not exactly the runtime loopback origin (403). No CORS headers. The CSP allows only 'self' (plus 'wasm-unsafe-eval' for Pyodide).
- The token reaches the renderer only through the Electrobun preload (non-writable globalThis.__BTG_TOKEN__). Never put it in a URL, the HTML, logs or storage.
- Validate every body, query and param with zod `.strict()` at the route boundary.
- Provider API keys live only in the OS keychain (src/server/secrets.ts). They never touch SQLite, logs, responses, exports or the renderer, which sees only `{ connected, last4 }`.
- LLM: no tools or function calling. OpenRouter/SpaceXAI requests never contain `tools`. Codex runs only through the user's installed `codex exec` with the hardened argv in docs/desktop-facts.md, in an empty per-call temp dir; any tool/command item aborts the call. Never read ~/.codex or call ChatGPT endpoints.
- Model output is untrusted. Parse it with zod and render it without raw HTML.
- User or uploaded content sent to an LLM is wrapped in <user_data>…</user_data>, and the system prompt declares it as data, not instructions.
- Python exercises run in the renderer's Pyodide worker with network APIs removed, an import allowlist, and a hard timeout. Grading is advisory: the user owns the machine.
- Resources that don't exist return 404.
TESTS: bun test. Write only the tests listed in a prompt. No network: mock with `mock.module` or injected deps. DB tests use src/server/testkit.ts (a fresh temp SQLite per file, migrated; reset() deletes app rows).
DONE: `bun run typecheck && bun test` is green, `bun run smoke` passes, and the prompt's VERIFY passes.
MODULE MAP (append one line per module: path · purpose · key exports):
- src/server/boot.ts + src/server/index.ts · start the backend programmatically (desktop shell, smoke) or headless (prints BTG_URL/BTG_TOKEN) · startServer
- src/server/localGuard.ts · Host, launch-token and exact-Origin guard, runtime origin · localGuard, tokenMatches, originAllowed, setRuntimeOrigin, guardOrigin
- src/server/http.ts · route wrapper (zod, body cap, Origin check on mutations, per-route rate limit), errors, response security headers · route, HttpError, json, secureResponse, readBodyCapped
- src/server/listener.ts · 127.0.0.1 listener: guarded API routes mounted directly; Pyodide assets; everything else (HTML bundle, hashed assets, dev HMR socket) proxied to the loopback upstream; immutable caching for production chunks · servePublic, MAX_REQUEST_BYTES, ApiRoutes
- src/server/rate.ts · token bucket · takeToken
- src/server/env.ts · validated env (NODE_ENV, optional OPENROUTER_BASE_URL) · env
- src/server/paths.ts · OS app-data dir (BTG_DATA_DIR override, XDG / Application Support / %APPDATA%, mode 0700) · appDataDir, databasePath
- src/server/db.ts + src/server/sqlmap.ts · Bun.SQL SQLite connection (WAL, foreign keys, busy timeout, migrations on open), row conversions · sql, activateDatabase, dateFromMs, epochOf, jsonText, jsonValue
- src/server/profile.ts · the single local profile · LOCAL_USER_ID, LOCAL_EMAIL, localProfile
- scripts/migrate.ts · checksummed, transactional, idempotent SQLite migration runner (`bun run migrate [path]`) · runMigrations
- scripts/build.ts · production bundle with the Tailwind plugin, copies Pyodide assets to dist/pyodide · none
- scripts/fetch-pyodide.ts · verify pinned Pyodide core assets and download SHA-256-pinned wheels into .cache/pyodide · none
- scripts/smoke.ts · headless backend check: /api/health 200 with the token, 401 without · none
- scripts/package-linux.ts + desktop/{main.ts,electrobun.config.ts} + .github/workflows/desktop.yml + docs/packaging.md · Electrobun shell (token preload, one window), AppImage and .deb packaging, CI matrix with signing/notarization/auto-update stubs · none
- src/server/secrets.ts · provider keys in the OS keychain via Bun.secrets · readProviderKey, storeProviderKey, deleteProviderKey, keyHint
- src/shared/providers.ts + src/server/llm/providers/{types,registry,openrouter,codex,codexRun,codexParse,spacexai,openaiSse,curated}.ts · provider adapters (OpenRouter SSE, Codex CLI JSONL, SpaceXAI OpenAI-compatible), 24 h model cache, curated fallbacks · ProviderAdapter, LlmEvent, ModelRef, providerAdapter, listConnectedModels, resolveModelRef, connectedProviderIds, parseCodexLine, codexExecArgv, openAiDataEvents
- src/server/llm/providers/codexLogin.ts + src/server/external.ts + src/web/openExternal.ts · in-app Codex sign-in through the official CLI (device code or browser, cancel, `codex logout`), CLI discovery beyond a launcher's minimal PATH, allowlisted system-browser links (key pages, OpenAI sign-in) via Electrobun Utils.openExternal · beginCodexLogin, cancelCodexLogin, readCodexLogin, signOutCodex, findCodexBin, parseCodexLoginText, setExternalOpener, openExternalUrl, openExternalTarget
- make-app.sh + make-app.cmd + scripts/make-app.ts · one-command app build for the current OS into artifacts/ · none
- src/server/llm/{core,gateway,sql,routes,models,timeouts}.ts + src/shared/sse.ts · chatJson/chatStream over the registry (per-task model from settings, native or prompted JSON, one retry on bad output), OpenRouter-only monthly budget, token usage per provider and model, /api/providers, /api/models, /api/usage · chatJson, chatStream, wrapUserData, insertLlmUsage, openRouterMonthMicros, listUsageGroups, llmRoutes, MODELS, parseSseChunk
- src/server/data/{export,sql,routes}.ts · export (zip of a VACUUM INTO snapshot) and delete-all (rows and stored keys) · exportDatabaseZip, deleteAppRows, dataRoutes
- src/server/lit/{core,sql,openalex}.ts · OpenAlex grounding, 7-day cache, citation filtering, optional mailto from settings · retrievePapers, buildSourcesBlock, filterCitations, toCitations, GROUNDING_RULES, normalizeQuery, abstractFromInverted
- src/shared/settings.ts · Settings schema with defaults (per-task models, budgetUsd, openalexMailto), deep-partial patch, merge with stale-model detection · Settings, SettingsPatch, mergeSettings
- src/shared/math.ts · wrap bare lesson LaTeX in $ delimiters before storage and render · wrapBareMath, MATH_DELIM_RULE
- src/server/learn/{core,sql,routes}.ts · SM-2, attempt pipeline (code attempts store the advisory client result), practice queue, settings routes · qualityOf, scheduleSm2, nextMastery, foldTopicStats, loadSettings, toQuestionPublic, insertCards, recordAttempt, learnRoutes
- src/server/topics/{core,sql}.ts · topic slugs, batched topic and edge upsert, lesson topic release · slugOf, upsertTopics, topicsReleasedByLesson, listMasteredNames, findMasteredSlugs
- src/server/gen/{core,sql,routes}.ts · 4-question practice sets (terminology, conceptual, mcq, free) modelled on standard homework/exam problems, style mimic, shared question normalizer · genRoutes, GenOut, CATEGORY_RULES, SOURCE_RULES, buildGenPrompt, toNewQuestion, normalizeQuestions, insertQuestions
- src/server/styles/{core,sql,routes}.ts · PDF/PNG style-profile uploads (magic bytes, profile only stored) · styleRoutes, sniffMime, acceptUpload, toFilePart
- src/server/teach/{core,sql,routes,prompts}.ts · grounded lessons that fold close prerequisites into opening steps and show only unmastered ones, lazy steps with a check whose category cycles by step index, streamed Socratic chat, lesson delete · teachRoutes, StepOut, categoryOfStep, normalizePlan, maxPlanSteps, unmetPrereqs, normalizeStep, buildChatContext, TUTOR_RULES, deleteLessonData, StoredPlan, SourcedPlanOut, toPublicPlan
- src/server/sources/{core,pdf,web,collect}.ts · lesson attachments: in-process PDF text via unpdf (25 MB, 60 pages, 30 s, 2 concurrent), SSRF-safe pinned URL fetch, attachment block, never stored · gatherSources, readPdf, fetchUrlSource, isPublicIp, checkSourceUrl, htmlToText, buildAttachmentBlock, ATTACHMENT_RULES
- src/server/stats/{core,sql,routes}.ts · topic-independent metrics, knowledge graph, daily cached insights · computeMetrics, streakOf, statsRoutes
- src/shared/season.ts + src/server/season/routes.ts · northern-hemisphere season from the clock, GET /api/season · Season, SeasonResponse, hemisphereOf, seasonOf, seasonRoutes
- src/shared/{code,codeGrade}.ts + src/web/pyodide/{runner,worker,net,harness,protocol}.ts + src/server/pyodideAssets.ts + src/web/components/CodeExercise.tsx · Python exercises in a Pyodide 314 Web Worker: library catalog (Pyodide-shipped only), import allowlist, network removal, timeout and memory termination, hidden-test harness, same-origin asset serving · CODE_LIBRARIES, CodeSpec, runPython, blockAllNetwork, HARNESS_PY, readPyodideAsset, CodeExercise
- src/web/{api,sse,session,router,connections}.ts(x) · typed fetch with the launch-token header (ApiError, describeError), SSE reader, session context (config/settings/season), provider connections context, first-run gate and routes · api, readLaunchHeaders, streamSse, useSession, useSettings, useSeason, useConnections, AppRouter
- src/web/askJob.ts · in-flight teach and practice requests that survive leaving the page · beginAskJob, finishAskJob, failAskJob, getAskJob, subscribeAskJob, useAskJob, generatingLessonPrompt, resetAskJob
- src/web/pages/{FirstRun,Settings,Usage}.tsx + src/web/components/{connections/*,settings/*,UsageMeter}.tsx + src/web/providerCopy.ts · first-run connect screen with cost explanation, AI connection cards (key entry, Codex sign-in), per-task default models with stale prompt, OpenRouter budget, export/delete-all, OpenAlex email, monthly token usage · FirstRun, ConnectionCards, KeyCard, CodexCard, ModelFields, BudgetField, DataSection, StaleModelBanner, UsageMeter, titleOfProvider
- src/web/theme.css + src/web/components/* · seasonal CSS variables keyed on <html data-season>, shell + UI primitives (AppShell, SeasonArt, Md, Panel, Button, Slider, Spinner, Logo) · Tailwind colours bg/panel/panel-2/border/text/muted/accent/accent-soft/accent-2/on-accent/danger
- src/web/pages/{Teach,Lesson,Practice,Stats,Graph}.tsx + src/web/components/{AskBar,AttachSources,QuestionCard,ConfidenceSlider,StepView,ChatPanel,Sources,UploadDrop,ErrorBanner,DeleteLessonButton}.tsx · teach canvas, lesson PDF/link attachments, lazy steps, streamed chat, practice queue, generation, style upload, lesson delete, stats and knowledge graph · AskBar, AttachSources, QuestionCard, StepView, StepSkeleton, ChatPanel, Sources, UploadDrop, ErrorBanner, ConfidenceSlider, DeleteLessonButton
- src/web/katexFonts.ts · KaTeX @font-face faces registered from hashed same-origin font files (scripts/build.ts strips the inlined data: fonts from katex.min.css) · registerKatexFonts
