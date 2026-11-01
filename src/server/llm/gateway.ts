import { z } from "zod";
import type { Citation, ErrorCode, Plan } from "../../shared/api.ts";
import { parseSseChunk } from "../../shared/sse.ts";
import { env } from "../env.ts";
import { HttpError } from "../http.ts";
import { takeToken } from "../rate.ts";
import { assertModelAllowed, buildMessages, completionBudget, countPromptChars, estimateMicros, parseJsonOutput, parsePricing, periodOf, readCompletion, readDelta, reasoningPayload, toSchemaName, type ChatMessage, type FilePart, type Turn, type Usage } from "./core.ts";
import { FREE_PRICE, MODELS, SYSTEM_MODELS, isModelListed, priceOf, setPricing, type SystemModelKey } from "./models.ts";
import { findUsage, reserveQuota, settleQuota } from "./sql.ts";
import { JSON_TIMEOUT_MS, STREAM_TIMEOUT_MS } from "./timeouts.ts";

export type Who = { uid: string; plan: Plan; capMicros: bigint };
export type ModelChoice = string | { system: SystemModelKey };
export type JsonCall<T> = { who: Who; model: ModelChoice; kind: string; system: string; user: string; schema: z.ZodType<T>; maxTokens: number; files?: FilePart[]; signal?: AbortSignal };
export type StreamCall = { who: Who; model: ModelChoice; kind: string; system: string; messages: Turn[]; maxTokens: number; signal: AbortSignal; onDone: (text: string) => Promise<{ citations?: Citation[] } | void> };

type Prepared = { uid: string; model: string; kind: string; period: string; est: bigint; cap: bigint; maxTokens: number; reasons: boolean; messages: ChatMessage[] };

const DAY_MS = 86_400_000;
const RETRY_MS = 60_000;
const enc = new TextEncoder();

// O(1)
function isFreeModelId(id: string): boolean {
  return id === "openrouter/free" || id.endsWith(":free");
}

// O(n) in the /models payload
// INV: failure keeps the previous pricing; a missing OPENROUTER_MODEL is priced at $0 only when its id is openrouter/free or ends with :free
export async function refreshPricing(fetchFn: typeof fetch = fetch): Promise<boolean> {
  try {
    const res = await fetchFn(`${env.OPENROUTER_BASE_URL}/models`, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`status ${res.status}`);
    const wanted = new Set([...MODELS.map((m) => m.id), ...Object.values(SYSTEM_MODELS)]);
    const map = parsePricing(await res.json(), wanted);
    if (!map.has(env.OPENROUTER_MODEL)) {
      if (isFreeModelId(env.OPENROUTER_MODEL)) map.set(env.OPENROUTER_MODEL, FREE_PRICE);
      else console.error("llm: system model unlisted");
    }
    if (map.size === 0) throw new Error("no allowlisted models listed");
    const dropped = [...wanted].filter((id) => !map.has(id));
    if (dropped.length > 0) console.error(`llm: dropping unlisted models: ${dropped.join(", ")}`);
    setPricing(map);
    return true;
  } catch {
    console.error("llm: /models refresh failed");
    return false;
  }
}

// O(1)
// INV: pricing stays unloaded (model calls answer 502 upstream) until the first successful refresh, so a dollar cap is never checked against a $0 guess; retries every minute until then, daily after
export function startPricingRefresh(): void {
  const tick = (): void => {
    void refreshPricing().then((ok) => setTimeout(tick, ok ? DAY_MS : RETRY_MS).unref());
  };
  tick();
}

// O(log n)
// SEC: short-circuits callers before unmetered pre-work when the user has no quota left
export async function assertQuotaHeadroom(who: Who): Promise<void> {
  const u = await findUsage(who.uid, periodOf(new Date()));
  if (u.usedMicros + u.reservedMicros >= who.capMicros) throw new HttpError(429, "quota_exceeded");
}

// O(1)
// SEC: a string model is client-chosen and must be in MODELS; system models are server-chosen
function chooseModel(choice: ModelChoice): string {
  if (typeof choice !== "string") return SYSTEM_MODELS[choice.system];
  assertModelAllowed(choice);
  if (!isModelListed(choice)) throw new HttpError(400, "model_not_allowed");
  return choice;
}

// O(n) in message size
// SEC: both per-token prices at 0 skip the dollar cap, so each user is limited to 200 of those calls per day
export function prepareCall(who: Who, choice: ModelChoice, kind: string, messages: ChatMessage[], maxTokens: number): Prepared {
  const model = chooseModel(choice);
  const { loaded, price } = priceOf(model);
  if (!price) throw loaded ? new HttpError(400, "model_not_allowed") : new HttpError(502, "upstream");
  if (price.promptPerTok === 0 && price.completionPerTok === 0 && !takeToken(`free-llm:${who.uid}`, 200, 200 / 1440)) throw new HttpError(429, "rate_limited");
  const reasons = MODELS.some((m) => m.id === model);
  const budget = completionBudget(maxTokens, reasons ? env.OPENROUTER_REASONING_LEVEL : null);
  const est = estimateMicros(price, countPromptChars(messages), budget);
  if (est > who.capMicros) throw new HttpError(429, "quota_exceeded");
  return { uid: who.uid, model, kind, period: periodOf(new Date()), est, cap: who.capMicros, maxTokens: budget, reasons, messages };
}

// O(1)
async function reserveOrThrow(p: Prepared): Promise<void> {
  if (!(await reserveQuota(p.uid, p.period, p.est, p.cap))) throw new HttpError(429, "quota_exceeded");
}

// O(1)
// SEC: fixed headers; no tools, no function calling; the API key never leaves this function
function postCompletion(p: Prepared, extra: Record<string, unknown>, signal: AbortSignal): Promise<Response> {
  return fetch(`${env.OPENROUTER_BASE_URL}/chat/completions`, {
    method: "POST",
    signal,
    headers: { authorization: `Bearer ${env.OPENROUTER_API_KEY}`, "content-type": "application/json", "HTTP-Referer": env.APP_ORIGIN, "X-Title": "BridgeToGrowth Learning" },
    body: JSON.stringify({ model: p.model, messages: p.messages, max_tokens: p.maxTokens, usage: { include: true }, ...extra, ...(p.reasons ? reasoningPayload(env.OPENROUTER_REASONING_LEVEL) : {}) }),
  });
}

// O(1)
// SEC: logs only the model id and HTTP status, never the body or headers, so an expired key or provider outage is diagnosable without leaking secrets
function logUpstreamFailure(model: string, res: Response | null): void {
  console.error(`llm: ${model} failed with ${res ? `HTTP ${res.status}` : "network error or timeout"}`);
}

// O(1)
function finalUsage(p: Prepared, u: Usage | null, conservative: boolean): Usage & { costMicros: bigint } {
  const cost = conservative || !u || u.costMicros === null ? p.est : u.costMicros;
  return { costMicros: cost, promptTokens: u?.promptTokens ?? null, completionTokens: u?.completionTokens ?? null };
}

// O(n) in response size
// SEC: upstream bodies are never forwarded; any failure is 502 upstream
async function runJsonAttempt(p: Prepared, format: Record<string, unknown>, signal: AbortSignal | undefined): Promise<{ content: string | null; costMicros: bigint }> {
  await reserveOrThrow(p);
  let usage: Usage | null = null;
  try {
    const timeout = AbortSignal.timeout(JSON_TIMEOUT_MS);
    const res = await postCompletion(p, format, signal ? AbortSignal.any([signal, timeout]) : timeout).catch(() => null);
    if (!res || !res.ok) {
      logUpstreamFailure(p.model, res);
      await res?.body?.cancel();
      throw new HttpError(502, "upstream");
    }
    const out = readCompletion(await res.json().catch(() => null));
    usage = out.usage;
    return { content: out.content, costMicros: finalUsage(p, usage, false).costMicros };
  } finally {
    await settleQuota(p.uid, p.period, p.kind, p.model, p.est, finalUsage(p, usage, false));
  }
}

// O(n) in prompt and response size
// INV: each attempt reserves and settles on its own; one retry on unparseable output, then 502 llm_bad_output
export async function chatJson<T>(o: JsonCall<T>): Promise<{ data: T; costMicros: bigint }> {
  const messages = buildMessages(o.system, [{ role: "user", content: o.user }], o.files);
  const p = prepareCall(o.who, o.model, o.kind, messages, o.maxTokens);
  const format = { response_format: { type: "json_schema", json_schema: { name: toSchemaName(o.kind), strict: true, schema: z.toJSONSchema(o.schema) } } };
  let total = 0n;
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await runJsonAttempt(p, format, o.signal);
    total += r.costMicros;
    const data = parseJsonOutput(r.content, o.schema);
    if (data !== null) return { data, costMicros: total };
  }
  throw new HttpError(502, "llm_bad_output");
}

// O(1)
function frameEvent(e: { t: "d"; v: string } | { t: "end"; citations?: Citation[] } | { t: "err"; code: ErrorCode }): Uint8Array {
  return enc.encode(`data:${JSON.stringify(e)}\n\n`);
}

// O(n) in streamed size
// INV: model/plan/pricing/cap errors throw synchronously so the route answers with a status; later errors arrive as an err event
// INV: a client abort aborts upstream and settles at est
export function chatStream(o: StreamCall): ReadableStream<Uint8Array> {
  const p = prepareCall(o.who, o.model, o.kind, buildMessages(o.system, o.messages), o.maxTokens);
  const upstream = new AbortController();
  let closed = false;
  const send = (ctrl: ReadableStreamDefaultController<Uint8Array>, chunk: Uint8Array): void => {
    if (closed) return;
    try {
      ctrl.enqueue(chunk);
    } catch {
      closed = true;
    }
  };
  const run = async (ctrl: ReadableStreamDefaultController<Uint8Array>): Promise<void> => {
    let usage: Usage | null = null;
    let reserved = false;
    try {
      await reserveOrThrow(p);
      reserved = true;
      const res = await postCompletion(p, { stream: true }, AbortSignal.any([upstream.signal, o.signal, AbortSignal.timeout(STREAM_TIMEOUT_MS)])).catch(() => null);
      if (!res || !res.ok || !res.body) {
        logUpstreamFailure(p.model, res);
        await res?.body?.cancel();
        throw new HttpError(502, "upstream");
      }
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buf = "";
      let text = "";
      for (;;) {
        const chunk = await reader.read().catch(() => null);
        if (!chunk) throw new HttpError(502, "upstream");
        if (chunk.done) break;
        const parsed = parseSseChunk(buf + chunk.value);
        buf = parsed.rest;
        for (const ev of parsed.events) {
          const d = readDelta(ev);
          if (d.failed) throw new HttpError(502, "upstream");
          if (d.usage) usage = d.usage;
          if (d.text) {
            text += d.text;
            send(ctrl, frameEvent({ t: "d", v: d.text }));
          }
        }
      }
      const extra = await o.onDone(text);
      send(ctrl, frameEvent(extra?.citations ? { t: "end", citations: extra.citations } : { t: "end" }));
    } catch (e) {
      const code: ErrorCode = e instanceof HttpError ? e.code : "internal";
      if (!(e instanceof HttpError)) console.error("llm: stream failed");
      send(ctrl, frameEvent({ t: "err", code }));
    } finally {
      if (reserved) await settleQuota(p.uid, p.period, p.kind, p.model, p.est, finalUsage(p, usage, o.signal.aborted || upstream.signal.aborted)).catch(() => console.error("llm: quota settlement failed"));
      if (!closed) {
        closed = true;
        try {
          ctrl.close();
        } catch {
          closed = true;
        }
      }
    }
  };
  return new ReadableStream<Uint8Array>({
    start(ctrl) {
      void run(ctrl);
    },
    cancel() {
      closed = true;
      upstream.abort();
    },
  });
}
