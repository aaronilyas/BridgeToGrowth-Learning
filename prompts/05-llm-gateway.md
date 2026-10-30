# P05 · LLM gateway: OpenRouter, model allowlist, quota, usage

GOAL: Every LLM call in the app goes through one gateway. The gateway enforces the plan's model allowlist and a monthly USD cap (atomic reserve, then settle), supports JSON-schema and streaming calls, and logs each call.

GIVEN: P04 (`ctx.plan`, `ctx.capMicros`).

DELIVER: `src/server/llm/{models.ts,core.ts,sql.ts,gateway.ts,routes.ts}` and schemas in `src/shared/api.ts`.

CONTRACT:
```ts
// models.ts — the operator edits this list; nothing else hardcodes a model ID.
export const MODELS: readonly { id: string; label: string; tier: "trial"|"pro"; vision: boolean }[];
export const SYSTEM_MODELS: { grade: string; extract: string /* vision+pdf */; insight: string };
// At implementation time, fill with live IDs from GET {OPENROUTER_BASE_URL}/models: 2 cheap trial-tier models, 4 frontier pro-tier models, plus cheap system models.
// Boot: fetch /models → Map<id,{promptPerTok,completionPerTok,ctx}>; drop and log allowlisted IDs that aren't listed; refresh every 24h. Pro may use trial-tier models.

// core.ts (pure)
export function periodOf(now: Date): string;                                          // O(1) first day of the UTC month, as YYYY-MM-01
export function estimateMicros(p: Price, promptChars: number, maxTokens: number): bigint; // O(1) ceil(chars/3)*prompt + maxTokens*completion
export function assertModelAllowed(id: string, plan: Plan): void;                    // O(1) throws 400 model_not_allowed
export function parseSseChunk(buf: string): { events: unknown[]; rest: string };     // O(len) splits on \n\n, ignores ':' comment lines, handles partial frames, "[DONE]"

// gateway.ts
export function chatJson<T>(o: { uid; plan; capMicros; model; kind: string; system: string; user: string; schema: z.ZodType<T>; maxTokens: number; files?: FilePart[] }): Promise<{ data: T; costMicros: bigint }>;
export function chatStream(o: { uid; plan; capMicros; model; kind; messages; maxTokens; signal: AbortSignal; onDone: (text: string) => Promise<void> }): ReadableStream<Uint8Array>; // SSE out: data:{"t":"d","v":"…"}  …  data:{"t":"end"} | data:{"t":"err","code":ErrorCode}
```
```
GET /api/models (auth)  → [{id,label,tier}] usable by the caller's plan
GET /api/usage  (auth)  → {plan, period, usedMicros, reservedMicros, capMicros, byModel:[{model,costMicros}], recent: last 20 llm_calls}
```
Call lifecycle (the same for every call):
1. Assert the model is allowed and the plan isn't `none`.
2. Compute `est`.
3. Reserve with one atomic statement: `INSERT … ON CONFLICT (user_id,period) DO UPDATE SET reserved_micros = reserved_micros + $est WHERE used_micros + reserved_micros + $est <= $cap RETURNING 1`. Before that, check `est <= cap` in core. If no row comes back, return 429 `quota_exceeded`.
4. `fetch ${base}/chat/completions` with headers `Authorization`, `HTTP-Referer: APP_ORIGIN` and `X-Title`. Body: `{model, messages, max_tokens, usage:{include:true}}`. For JSON calls, add `response_format:{type:"json_schema", json_schema:{name, strict:true, schema: z.toJSONSchema(schema)}}`.
5. Parse JSON output with `schema.safeParse`. On failure, retry once; on a second failure, return 502 `llm_bad_output`.
6. In `finally`, settle in one statement: `reserved -= est`, `used += actual`. `actual = ceil(usage.cost*1e6)` if present, otherwise `est`. Insert an `llm_calls` row.

INV:
- The `model` value from the client is always checked against `MODELS` for the plan. The server never forwards arbitrary IDs.
- No tools or function calling are sent. `system` is always server-authored. User text goes only in `user` messages, wrapped in `<user_data>`.
- Upstream error bodies are never forwarded. Non-2xx responses and timeouts (JSON 60 s, stream 120 s) return 502 `upstream`.
- If the client aborts a stream, the upstream request is aborted too and settlement uses `est` (the conservative choice).
- At boot, run `UPDATE usage_periods SET reserved_micros = 0`. `// INV: single process ⇒ no in-flight reservations at boot`.
- Quota check and settle are each one indexed statement, O(1).

TESTS (max 3):
1. Real DB: 20 concurrent `reserve()` calls against a cap that fits exactly 5. Exactly 5 succeed, and `reserved_micros` equals 5×est.
2. `parseSseChunk`: frames split mid-line and mid-JSON, plus `: OPENROUTER PROCESSING` comments and `[DONE]`, yield exactly the expected deltas and the usage object.
3. `assertModelAllowed`: a pro-tier ID on the trial plan throws `model_not_allowed`, and an unknown ID throws for every plan.

VERIFY: `bun test`. Logged in as a trial user, call a temporary dev-only script `scripts/smoke-llm.ts` that uses `chatJson` with a trivial schema. Confirm the result, the new `llm_calls` row and that `/api/usage` reflects the cost. Delete the script afterward.

NO: provider fallbacks, caching responses, BYO API keys, embeddings.
