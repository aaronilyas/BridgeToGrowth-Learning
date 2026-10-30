# P00 · Bootstrap, agent conventions, server skeleton

GOAL: A Bun + TypeScript app where one `Bun.serve` process on `127.0.0.1:$PORT` serves `GET /api/health` and a React SPA, and `CLAUDE.md` encodes the conventions every later prompt obeys.

GIVEN: An empty repo containing `LICENSE`, `README.md` and `Example-UI/*.jpg` (seasonal UI mockups, used in P11).

DELIVER:
- `CLAUDE.md`: the block below, verbatim. Also `AGENTS.md`, a symlink to `CLAUDE.md`.
- `package.json` with exact-pinned deps (no `^` or `~`): `zod@4`, `stripe`, `react@19`, `react-dom@19`, `wouter`, `react-markdown`, `remark-math`, `rehype-katex`, `katex`, `d3-force`, `tailwindcss@4`, `bun-plugin-tailwind`, and `@types/*` as needed. Also commit `bun.lock`.
- Scripts: `dev` (`bun --hot src/server/index.ts`), `build` (`bun build --target=bun --production src/server/index.ts --outdir dist`), `start`, `typecheck` (`tsc --noEmit`), `test` and `migrate`.
- `bunfig.toml`, which registers the Tailwind plugin for `[serve.static]`.
- `tsconfig.json` with `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` and `verbatimModuleSyntax`.
- `.gitignore`, which ignores `.env*` except `.env.example`, plus `node_modules` and `dist`.
- `.env.example`, holding placeholder values that pass validation.
- `src/server/env.ts`: zod-parsed `process.env`. On invalid input it prints the key names only (never the values) and exits with code 1.
- `src/server/http.ts`: `HttpError`, `json()` and `route()`.
- `src/server/rate.ts`: a token bucket.
- `src/server/index.ts`: `Bun.serve({ hostname: "127.0.0.1", port, maxRequestBodySize: 12 * 2**20, routes })`. The `"/*"` route serves the HTML import of `src/web/index.html`.
- `src/shared/api.ts`: the `ErrorCode` union plus zod schemas. Later prompts append to it.
- `src/web/index.html` and `src/web/main.tsx`. For now the page renders the text `ok`.

ENV (declare every variable now, so later prompts only read them):
`NODE_ENV`, `PORT=3000`, `APP_ORIGIN` (URL), `DATABASE_URL`, `TEST_DATABASE_URL?`, `OPENROUTER_API_KEY`, `OPENROUTER_BASE_URL=https://openrouter.ai/api/v1`, `STRIPE_SECRET_KEY` (must start with `sk_`), `STRIPE_WEBHOOK_SECRET` (must start with `whsec_`), `STRIPE_PRICE_ID` (must start with `price_`), `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET`, `OPENALEX_MAILTO` (email), `TRIAL_DAYS=7`, `TRIAL_CAP_USD=1`, `PRO_CAP_USD=15`.
In `.env.example`, use the Turnstile test keys `1x00000000000000000000AA` / `1x0000000000000000000000000000000AA`.

CONTRACT:
```ts
// src/shared/api.ts
export type ErrorCode = "bad_request"|"unauthenticated"|"forbidden_origin"|"not_found"|"rate_limited"|"payment_required"|"quota_exceeded"|"model_not_allowed"|"email_taken"|"bad_credentials"|"turnstile_failed"|"unsupported_media"|"too_large"|"already_subscribed"|"upstream"|"llm_bad_output"|"internal";
// src/server/http.ts
export class HttpError extends Error { constructor(readonly status: number, readonly code: ErrorCode) }
export type Ctx<B> = { req: Request; ip: string; params: Record<string,string>; body: B };
export type RouteOpts<B> = { body?: z.ZodType<B>; rate?: { key: string; cap: number; perMin: number }; csrf?: boolean /* default: true for non-GET */; maxBody?: number /* default 64 KiB */ };
export function route<B>(opts: RouteOpts<B>, fn: (c: Ctx<B>) => Promise<Response>): (req: Request) => Promise<Response>;
// P03 adds opts.auth and ctx.user. P04 adds opts.entitled.
```

INV:
- `ip` comes from the `cf-connecting-ip` header, or `"local"` if it's missing. Add `// SEC:` noting this is trustworthy only because the server binds to 127.0.0.1 and cloudflared is the only ingress.
- `route()` checks run in this order: content-length is at most `maxBody` (otherwise 413 `too_large`); CSRF, meaning `Origin` must equal `APP_ORIGIN` (otherwise 403 `forbidden_origin`); rate limit (429); body parsed with zod `.strict()` (400); handler. An `HttpError` maps to `{error: code}` with its status. Any other throw becomes a 500 `{error:"internal"}` and is logged as message plus stack only.
- Every JSON response carries `cache-control: no-store`, `x-content-type-options: nosniff` and `content-type: application/json`.
- The rate limiter is `Map<string, {tokens, t}>` with an O(1) take. A sweep every 60 s deletes full buckets, and the map is hard-capped at 100k keys (when over the cap, it denies).
- `GET /api/health` returns `{ok:true}`. It has no auth and doesn't touch the DB.

`CLAUDE.md` (write verbatim):
```md
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
```

TESTS (max 1):
1. `route()`: a POST with `Origin: https://evil.test` returns 403 `forbidden_origin`. A POST with the correct origin and a body containing an unknown key returns 400.

VERIFY:
- `bun run typecheck && bun test`
- `bun run dev`, then `curl -s 127.0.0.1:3000/api/health` returns `{"ok":true}`. Opening `/` in a browser shows `ok`.
- `ss -ltnp | grep :3000` shows `127.0.0.1` only.

NO: DB, auth, UI styling.
