# Agent contract (optimized for agents, not humans)
STACK: Bun>=1.2 · TS strict · Bun.serve routes · Bun.sql (Postgres>=16, local) · Bun.password (argon2id) · zod v4 · React 19 + wouter + Tailwind v4 · OpenRouter (DeepSeek V4.1 Flash, GLM-5.3-Flash, GPT-6-Luna; system calls use OPENROUTER_MODEL) · Stripe · Turnstile · OpenAlex · Cloudflare Tunnel (the only ingress; the server binds 127.0.0.1).
PLANS: free and pro, decided only by billing/core.ts entitlementOf. Caps, price and lesson TTL come from env (FREE_CAP_USD, PRO_CAP_USD, PRO_PRICE_USD, FREE_LESSON_TTL_DAYS). Gate pro features server-side with route({ auth: true, pro: true }); the UI gate (ProGate) is cosmetic.
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
- src/server/http.ts · route wrapper (session, plan gate, per-user rate limit), errors · route, HttpError, json, originAllowed
- src/server/rate.ts · token bucket · takeToken
- src/server/env.ts · validated env · env
- src/server/db.ts · shared Bun.sql pool · sql
- scripts/migrate.ts · checksummed migration runner (`bun run migrate [url]`) · none
- scripts/db-setup.sh · create role btg + DBs btg, btg_test · none
- scripts/build.ts · production bundle with the Tailwind plugin (`bun run build`; run dist/index.js from dist/) · none
- scripts/stripe-setup.ts · create or reuse the Pro price and webhook endpoint · none
- scripts/set-password.ts · operator password reset, `--claim-local` turns local@localhost into an account · none
- deploy/{install.sh,setup-tunnel.sh,cloudflared/,systemd/,cloudflare-dashboard.md} · /opt/btg install, Cloudflare Tunnel, units, dashboard checklist · none
- src/server/auth/{core,sql,routes,turnstile,verify,account,mail,customer}.ts · email+password accounts, sessions, Turnstile, signed-in password change, email reset links, account deletion · authRoutes, accountRoutes, AuthUser, hashToken, readSessionToken, findSession, verifyTurnstile, verifyPassword, setUserPassword, claimLocalProfile, passwordResetEnabled, sendPasswordReset, deleteAccountCustomer, LEGACY_LOCAL_EMAIL
- src/server/billing/{core,sql,routes,stripe}.ts · free/pro entitlement, plan terms, lesson expiry, Stripe checkout/portal/sync/cancel/resume, order-independent webhook, customer delete on account deletion · billingRoutes, entitlementOf, readPlanTerms, computeLessonExpiry, snapshotSubscription, applyStripeEvent, saveUserSubscription, findCustomerSubscription, deleteStripeCustomer
- src/server/testkit.ts · test env + test DB helpers (import statically, server modules dynamically after boot); createTestUser({ plan }) returns a session cookie · bootTestServer, createTestUser, callRoute, TEST_ENV, TEST_ORIGIN
- src/server/llm/{models,core,sql,gateway,routes}.ts + src/shared/sse.ts · selectable OpenRouter models (free plan: first model only) with one shared reasoning level, reserve/settle against the plan's dollar cap, usage API · MODELS, SYSTEM_MODELS, chatJson, chatStream, refreshPricing, assertModelAllowed, listModelsForPlan, reasoningPayload, completionBudget, reserveQuota, llmRoutes, parseSseChunk
- src/server/lit/{core,sql,openalex}.ts · OpenAlex grounding, 7-day cache, citation filtering · retrievePapers, buildSourcesBlock, filterCitations, toCitations, GROUNDING_RULES, normalizeQuery, abstractFromInverted
- src/shared/settings.ts · Settings schema with defaults, deep-partial patch, merge · Settings, SettingsPatch, mergeSettings
- src/shared/math.ts · wrap bare lesson LaTeX in $ delimiters before storage and render · wrapBareMath, MATH_DELIM_RULE
- src/server/learn/{core,sql,routes}.ts · SM-2, attempt pipeline, practice queue, settings routes · qualityOf, scheduleSm2, nextMastery, foldTopicStats, loadSettings, resolveModel, toQuestionPublic, insertCards, recordAttempt, learnRoutes
- src/server/topics/{core,sql}.ts · topic slugs, batched topic and edge upsert, lesson topic release · slugOf, upsertTopics, topicsReleasedByLesson, listMasteredNames, findMasteredSlugs
- src/server/gen/{core,sql,routes}.ts · 4-question practice sets (terminology, conceptual, mcq, free) modelled on standard homework/exam problems, style mimic, shared question normalizer · genRoutes, GenOut, CATEGORY_RULES, SOURCE_RULES, buildGenPrompt, toNewQuestion, normalizeQuestions, insertQuestions
- src/server/styles/{core,sql,routes}.ts · PDF/PNG style-profile uploads (magic bytes, profile only stored) · styleRoutes, sniffMime, acceptUpload, toFilePart
- src/server/teach/{core,sql,routes,prompts}.ts · grounded lessons (free-plan lessons expire; deleteExpiredLessons sweeps them) that fold close prerequisites into opening steps and show only unmastered ones, lazy steps with a check whose category cycles by step index, streamed Socratic chat, lesson delete · teachRoutes, StepOut, categoryOfStep, normalizePlan, maxPlanSteps, unmetPrereqs, stripPrereqLine, normalizeStep, buildChatContext, TUTOR_RULES, deleteLessonData, StoredPlan, SourcedPlanOut, toPublicPlan
- src/server/sources/{core,pdf,web,collect}.ts · lesson attachments: PDF text extraction or Ghostscript compression in a sandboxed subprocess, SSRF-safe pinned URL fetch, attachment block, never stored · gatherSources, readPdf, fetchUrlSource, isPublicIp, checkSourceUrl, htmlToText, buildAttachmentBlock, ATTACHMENT_RULES
- src/server/stats/{core,sql,routes}.ts · topic-independent metrics, knowledge graph, daily cached insights · computeMetrics, streakOf, statsRoutes
- src/shared/season.ts + src/server/season/routes.ts · northern-hemisphere season from the server clock, GET /api/season · Season, SeasonResponse, hemisphereOf, seasonOf, seasonRoutes
- src/web/{api,sse,session,router}.ts(x) · typed fetch (ApiError, describeError), SSE reader, session context (me/config/settings/season), guarded wouter routes · api, streamSse, useSession, useMe, useIsPro, usePlanTerms, useSettings, useSeason, AppRouter
- src/web/askJob.ts · in-flight teach and practice requests that survive leaving the page · beginAskJob, finishAskJob, failAskJob, getAskJob, subscribeAskJob, useAskJob, generatingLessonPrompt, resetAskJob
- src/web/theme.css + src/web/components/* · seasonal CSS variables keyed on <html data-season>, shell + UI primitives (AppShell, SeasonArt, Md, Panel, Button, Slider, Spinner, Logo, Placeholder) · Tailwind colours bg/panel/panel-2/border/text/muted/accent/accent-soft/accent-2/on-accent/danger
- src/web/pages/{Teach,Lesson,Practice}.tsx + src/web/components/{AskBar,AttachSources,QuestionCard,ConfidenceSlider,StepView,ChatPanel,Sources,UploadDrop,ErrorBanner,DeleteLessonButton}.tsx · teach canvas, lesson PDF/link attachments, lazy steps, streamed chat, practice queue, generation, style upload, lesson delete · AskBar, AttachSources, QuestionCard, StepView, StepSkeleton, ChatPanel, Sources, UploadDrop, ErrorBanner, ConfidenceSlider, DeleteLessonButton
- src/shared/code.ts + src/server/code/{core,harness,sandbox,routes}.ts + src/web/components/CodeExercise.tsx · Python code exercises: library catalog, bubblewrap+prlimit sandbox with per-question import allowlist, hidden-test grading, POST /api/code/run · CODE_LIBRARIES, CodeSpec, buildSandboxArgv, parseHarnessLine, settleRun, scoreTests, codeFeedback, toCodeParts, HARNESS_PY, codeRuntime, runInSandbox, codeRoutes, CodeExercise, LibraryList, TestResults
- src/web/pages/{Login,Signup,Forgot,Reset,Account,Billing,Cancel}.tsx + src/web/components/{AuthForm,Turnstile,PlanCard,ProGate}.tsx + src/web/money.ts · sign-in, password reset, account deletion, plan comparison, Stripe redirects, pro upsell · AuthForm, Turnstile, PlanCard, ProGate, UpgradeNotice, formatMicros, formatCents
