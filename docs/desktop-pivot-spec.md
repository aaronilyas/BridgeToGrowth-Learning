# Pivot spec (temporary; removed at integration)

BridgeToGrowth Learning becomes a local desktop app where users bring their own subscription or API key.

Where this spec conflicts with CLAUDE.md, this spec wins for the items under "Removed" and "Decisions". Otherwise keep CLAUDE.md's CODE, SQL, SECURITY and TESTS rules. Phase 0 results are recorded in docs/desktop-facts.md, which is authoritative for CLI flags, endpoints and the fallbacks taken. The SpaceXAI adapter is API key only. Codex uses `codex exec --json`. The DB is Bun.SQL sqlite. Secrets use Bun.secrets. The shell is Electrobun.

## Product end state
- A single-user desktop app. It opens one native window with the same UI and features as today: teach canvas, lessons with lazy steps, Socratic chat, practice queue and generation, style uploads, Python code exercises, PDF and link attachments, stats, the knowledge graph and insights, seasonal theme, and settings.
- No accounts, plans, billing, ads, captcha, email, or server deployment. Every former Pro feature is available to everyone.
- The user connects one or more AI sources in Settings → AI connections: OpenRouter with an API key; Codex through their ChatGPT subscription via the official Codex CLI; SpaceXAI with an API key (Phase 0 fallback).
- The user picks a default model per task: lesson, chat, practice generation, system (grading/extraction/insights). Any model from any connected provider can be picked.
- A first-run screen blocks the app until at least one provider is connected. It explains the costs: an API key bills the user's provider account; a subscription consumes the user's plan limits.
- Usage page: tokens per provider and model per month. USD cost appears only where the provider reports it (OpenRouter). An optional monthly USD budget applies to OpenRouter only.
- Data lives in the OS app-data directory (XDG on Linux, Application Support on macOS, %APPDATA% on Windows). Settings → Data offers export (zip of the DB) and delete-all.
- Platforms: Linux first (AppImage and .deb), then macOS and Windows builds from CI. Code signing, notarization and auto-update are out of scope. Leave stubs and document them.

## Removed (delete the code, routes, UI, env vars, tests and docs)
- The auth module: signup, login, sessions, password reset, account deletion. Replace it with one implicit local profile. Reuse LEGACY_LOCAL_EMAIL/claim-local logic only if it simplifies; otherwise delete it.
- Billing, plan gating (entitlementOf, `pro: true`, the Pro UI gate, PlanCard), dollar caps from env, free-lesson TTL and its sweep.
- Ads (CSP nonce document decoration, /ads.txt, AdSlot), the captcha widget, the transactional mail provider.
- deploy/**, the reverse proxy, systemd, Postgres setup scripts, scripts/stripe-setup.ts, scripts/set-password.ts, scripts/db-setup.sh.
- The Linux namespace sandbox (bubblewrap/prlimit/cgroup v2) and the poppler/Ghostscript tools.

## Decisions
- Runtime: the existing Bun server stays the backend, running inside the desktop shell. The window loads it through a loopback URL. Server modules stay in the routes/core/sql split.
- Database: SQLite via Bun.SQL (`sqlite://<path>`). Port db/migrations to a fresh SQLite set starting at 0001. Postgres features (case-insensitive text, `= ANY`, jsonb, timestamptz, partial indexes) get SQLite equivalents. Batching stays: use `IN ${sql(ids)}` or json_each. The user_id predicate rule is dropped (single local user); keep the column only if removing it costs more, and state which you chose. WAL mode and foreign_keys=ON. Writes are still grouped in transactions.
- Code exercises: Python in Pyodide inside a Web Worker in the renderer, from a pinned bundled Pyodide with no CDN at runtime. Import allowlist per question, as today. A hard timeout terminates the worker. A memory cap is enforced by terminating the worker. The worker has no network: block fetch/XHR/WebSocket and do not load micropip. Hidden tests run in the worker. Grading is now advisory (user owns the machine); say so in UI copy. Keep the CODE_LIBRARIES catalog limited to packages Pyodide ships.
- PDF attachments and style uploads: extract text in-process with a pure-JS PDF library (unpdf, new dep with a justification line in the commit body). Ghostscript compression is dropped. Enforce the size, page and time limits that exist today.
- Secrets: API keys live only in the OS keychain (Bun.secrets). They never touch SQLite, logs, the renderer, exports, or crash reports. The renderer sees only `{ connected: boolean, last4?: string }`.
- Local server hardening: bind 127.0.0.1 on a random port. Generate a per-launch 256-bit token. The shell injects it, and every /api request must present it in a header. Reject any Host other than the loopback host:port (DNS rebinding). Mutating routes still require an exact Origin match. No CORS. The CSP stays strict, with no third-party script origins.

## Provider API
Location: src/server/llm/providers/{types,registry,openrouter,codex,spacexai}.ts + src/shared/providers.ts (zod schemas for the HTTP surface). No classes: an adapter is a record of functions.

```ts
type ProviderId = "openrouter" | "codex" | "spacexai";
type AuthKind = "api_key" | "subscription";
type ReasoningLevel = "low" | "high" | "max";
type ModelRef = { provider: ProviderId; id: string; label: string; vision: boolean; structured: "native" | "prompted"; reasoning: readonly ReasoningLevel[]; contextTokens: number };
type ChatMessage = { role: "user" | "assistant"; text: string; images?: readonly ImagePart[] };
type LlmRequest = { model: ModelRef; system: string; messages: readonly ChatMessage[]; reasoning: ReasoningLevel; maxOutputTokens: number; signal: AbortSignal; jsonSchema?: Record<string, unknown> };
type LlmEvent = { type: "text"; delta: string } | { type: "usage"; inputTokens: number; outputTokens: number; costUsd: number | null } | { type: "done" } | { type: "error"; code: LlmErrorCode };
type LlmErrorCode = "not_connected" | "auth_expired" | "rate_limited" | "quota_exhausted" | "model_unavailable" | "bad_output" | "timeout" | "provider_error";
type ConnectionStatus = { provider: ProviderId; auth: AuthKind; connected: boolean; detail: "ok" | "cli_missing" | "logged_out" | "key_invalid" | "unreachable" };
type ProviderAdapter = { id: ProviderId; auth: AuthKind; status: () => Promise<ConnectionStatus>; listModels: () => Promise<readonly ModelRef[]>; stream: (req: LlmRequest) => AsyncIterable<LlmEvent> };
```

Required behaviour:
- chatJson and chatStream keep their call sites. They resolve the model through the registry and call adapter.stream. chatJson collects text and parses with the caller's zod schema; native structured output where available, otherwise prompt-level JSON. Retry once on bad_output, then fail with bad_output.
- The `<user_data>` wrapping and "data, not instructions" system-prompt rules stay for every provider.
- No model may execute tools. OpenRouter/SpaceXAI: never send `tools`. Codex: the flags in docs/desktop-facts.md, in an empty temp working directory created per call and removed after, network disabled for the sandbox. Any tool or command item in Codex's stream aborts the call with provider_error and is logged by type only.
- Codex subscription use goes only through the official CLI the user installed and signed in to. Never read, copy or refresh ~/.codex credentials, and never call ChatGPT backend endpoints directly. Login is started by spawning the CLI's own `codex login`, which opens the user's browser.
- Model lists are fetched from each provider and cached 24 h in SQLite. A curated default list (today's MODELS) is shown for OpenRouter when the fetch fails. No plan-tier restriction.
- An abort from the HTTP client kills the CLI subprocess or the fetch within 1 s.

HTTP surface (zod .strict() on everything):
- GET /api/providers → ConnectionStatus[]
- PUT /api/providers/:id/key {key}: validate with a cheap authenticated call, then store in the keychain. DELETE /api/providers/:id/key.
- POST /api/providers/:id/login starts a subscription login; GET /api/providers/:id/login polls it.
- GET /api/models → ModelRef[] across connected providers.
- Settings gains `models: { lesson, chat, practice, system }`, each `{ provider, id }`, and `budgetUsd?: number`. mergeSettings handles a stale model whose provider is now disconnected by returning null plus a UI prompt.
- GET /api/usage → per-provider, per-model monthly tokens, plus cost where known.

## Workstreams
- A. Desktop shell and packaging: shell, token injection, window, app-data paths, Linux packaging, CI matrix stub.
- B. Database port to SQLite: migrations, every sql.ts, the test kit.
- C. Removals: auth, billing, ads, captcha, mail, deploy, plan gates and UI, env schema trimmed to what remains (OPENALEX_MAILTO becomes a setting with a sensible default).
- D. Provider layer: types, registry, three adapters, keychain storage, routes, usage.
- E. Code exercises in Pyodide: worker runtime, grading, UI copy.
- F. PDF/style uploads in JS.
- G. Settings, first-run, usage and connections UI.
- H. Integration and docs (orchestrator only).

## Tests (write only these)
- providers/codex.test.ts: parse recorded CLI JSONL fixtures. Text deltas stream in order. Usage is mapped. A tool or command event aborts with provider_error. A logged-out status maps to not_connected.
- providers/openrouter.test.ts: SSE parsing to LlmEvent. 401 → key_invalid/auth_expired. 429 → rate_limited. The request never contains `tools`.
- providers/registry.test.ts: chatJson retries once on bad JSON then fails with bad_output. A disconnected provider fails with not_connected.
- secrets.test.ts (Bun.secrets mocked): a key round-trips. GET /api/providers never contains the key. An export zip never contains the key.
- localGuard.test.ts: missing or wrong launch token → 401. Foreign Host → 421 or 400. Foreign Origin on a mutation → 403.
- migrations.test.ts: SQLite migrations apply to an empty DB and are idempotent.
- pyodideRunner.test.ts: an infinite loop is terminated by the timeout. A disallowed import is rejected. A fetch from user code fails.
- Delete tests for removed modules. Update remaining DB tests to the SQLite test kit.

## DONE
- `bun run typecheck && bun test` green.
- No mentions of the removed vendors/tools in src, scripts, docs (except docs/desktop-facts.md history notes).
- Linux build produces a launchable AppImage. A smoke script starts the backend headless and checks /api/health with the token → 200 and without → 401.
- Commit per workstream with clear messages. Do not push.
