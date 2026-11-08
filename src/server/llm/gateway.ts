import { z } from "zod";
import type { ErrorCode, StreamEvent } from "../../shared/api.ts";
import type { Settings } from "../../shared/settings.ts";
import { HttpError } from "../http.ts";
import { loadSettings } from "../learn/core.ts";
import { localProfile } from "../profile.ts";
import { buildMessages, completionBudget, parseJsonOutput, visibleLength, type ContentPart, type FilePart, type Turn } from "./core.ts";
import { providerAdapter, resolveTaskModel } from "./providers/registry.ts";
import type { ChatMessage as ProviderMessage, ImagePart, LlmErrorCode, LlmRequest, ReasoningLevel } from "./providers/types.ts";
import { insertLlmUsage, openRouterMonthMicros } from "./sql.ts";

export type Who = { uid: string };
export type SystemModelKey = "grade" | "extract" | "insight";
export type ModelChoice = string | { system: SystemModelKey };
export type ModelTask = "lesson" | "chat" | "practice" | "system";
export type JsonCall<T> = { who: Who; model: ModelChoice; kind: string; system: string; user: string; schema: z.ZodType<T>; maxTokens: number; files?: FilePart[]; signal?: AbortSignal };
export type StreamEnd = Omit<Extract<StreamEvent, { t: "end" }>, "t">;
// INV: text from the first hideFrom on is never forwarded while streaming; onDone receives the full text and returns the final state; announcePrep tells the page a slower finish is under way
export type StreamCall = { who: Who; model: ModelChoice; kind: string; system: string; messages: Turn[]; maxTokens: number; signal: AbortSignal; hideFrom: string; onDone: (text: string, announcePrep: () => void) => Promise<StreamEnd> };

const REASONING: ReasoningLevel = "high";
const enc = new TextEncoder();
const HTTP: Record<LlmErrorCode, { status: number; code: ErrorCode }> = {
  not_connected: { status: 409, code: "not_connected" },
  auth_expired: { status: 401, code: "auth_expired" },
  rate_limited: { status: 429, code: "rate_limited" },
  quota_exhausted: { status: 402, code: "quota_exhausted" },
  model_unavailable: { status: 404, code: "model_unavailable" },
  bad_output: { status: 502, code: "bad_output" },
  timeout: { status: 504, code: "timeout" },
  provider_error: { status: 502, code: "provider_error" },
};

type CoreMessage = { role: "system" | "user" | "assistant"; content: string | ContentPart[] };
type UsageSeen = { inputTokens: number; outputTokens: number; costUsd: number | null };

// O(1)
// INV: no reasoning setting exists, so every call uses the constant high effort
function taskForKind(kind: string, model: ModelChoice): ModelTask {
  if (typeof model !== "string") return "system";
  if (kind === "chat") return "chat";
  if (kind === "gen") return "practice";
  return "lesson";
}

// O(1)
function mapLlmError(code: LlmErrorCode): HttpError {
  const mapped = HTTP[code];
  return new HttpError(mapped.status, mapped.code);
}

// O(n) in attached files
function imagesOf(files: readonly FilePart[]): ImagePart[] {
  return files.map((part) => {
    const url = part.type === "image_url" ? part.image_url.url : part.file.file_data;
    const end = url.indexOf(";");
    const mime = url.startsWith("data:") && end > 5 ? url.slice(5, end) : "application/octet-stream";
    return { mime, dataUrl: url };
  });
}

// O(n) in the transcript
// SEC: buildMessages already wraps user turns as data and appends the data-not-instructions notice
function providerMessages(built: CoreMessage[]): { system: string; messages: ProviderMessage[] } {
  let system = "";
  const messages: ProviderMessage[] = [];
  for (const message of built) {
    if (message.role === "system") {
      system = typeof message.content === "string" ? message.content : "";
      continue;
    }
    if (typeof message.content === "string") {
      messages.push({ role: message.role, text: message.content });
      continue;
    }
    const texts: string[] = [];
    const files: FilePart[] = [];
    for (const part of message.content) {
      if (part.type === "text") texts.push(part.text);
      else files.push(part);
    }
    const images = imagesOf(files);
    if (images.length > 0) messages.push({ role: message.role, text: texts.join("\n"), images });
    else messages.push({ role: message.role, text: texts.join("\n") });
  }
  return { system, messages };
}

// O(1)
// SEC: the optional budget applies only to OpenRouter, using this month's settled cost
async function assertOpenRouterBudget(settings: Settings, provider: string): Promise<void> {
  if (provider !== "openrouter" || settings.budgetUsd === null) return;
  const now = new Date();
  const spent = await openRouterMonthMicros(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1), Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  if (spent >= BigInt(Math.floor(settings.budgetUsd * 1_000_000))) throw new HttpError(402, "quota_exhausted");
}

// O(n) in the prompt
// INV: an unset task model falls back to the requested id, the legacy default id, then any connected model
async function prepare(settings: Settings, task: ModelTask, requested: string | null, system: string, turns: Turn[], files: FilePart[], maxTokens: number, schema: Record<string, unknown> | null, signal: AbortSignal): Promise<{ req: LlmRequest; provider: string; modelId: string }> {
  const model = await resolveTaskModel(settings.models[task], [requested, settings.model]);
  await assertOpenRouterBudget(settings, model.provider);
  const built = providerMessages(buildMessages(system, turns, files));
  const native = schema !== null && model.structured === "native";
  const req: LlmRequest = {
    model,
    system: native || schema === null ? built.system : `${built.system}\n\nRespond with JSON only, matching this JSON Schema:\n${JSON.stringify(schema)}`,
    messages: built.messages,
    reasoning: REASONING,
    maxOutputTokens: completionBudget(maxTokens, settings.limits, model.reasoning.length > 0),
    signal,
    ...(native && schema !== null ? { jsonSchema: schema } : {}),
  };
  return { req, provider: model.provider, modelId: model.id };
}

// O(n) in the event stream
// SEC: provider failures become error codes; response bodies are not forwarded
async function collect(req: LlmRequest): Promise<{ text: string; usage: UsageSeen | null; error: LlmErrorCode | null }> {
  let text = "";
  let usage: UsageSeen | null = null;
  try {
    for await (const event of providerAdapter(req.model.provider).stream(req)) {
      if (event.type === "text") text += event.delta;
      else if (event.type === "usage") usage = { inputTokens: event.inputTokens, outputTokens: event.outputTokens, costUsd: event.costUsd };
      else if (event.type === "error") return { text, usage, error: event.code };
    }
  } catch {
    return { text, usage, error: "provider_error" };
  }
  return { text, usage, error: null };
}

// O(1)
async function record(kind: string, provider: string, model: string, usage: UsageSeen | null): Promise<bigint> {
  if (usage === null) return 0n;
  const costMicros = usage.costUsd === null || !Number.isFinite(usage.costUsd) || usage.costUsd < 0 ? null : BigInt(Math.ceil(usage.costUsd * 1_000_000));
  await insertLlmUsage({ provider, model, kind, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, costMicros });
  return costMicros ?? 0n;
}

// O(n) in the prompt and response
// INV: one retry after bad JSON, then bad_output; other provider errors are not retried
// INV: settings.limits.timeoutSeconds bounds the whole call, both attempts included
export async function chatJson<T>(o: JsonCall<T>): Promise<{ data: T; costMicros: bigint }> {
  const schema = z.toJSONSchema(o.schema) as unknown as Record<string, unknown>;
  const settings = loadSettings(await localProfile());
  const timeout = AbortSignal.timeout(settings.limits.timeoutSeconds * 1000);
  const prepared = await prepare(settings, taskForKind(o.kind, o.model), typeof o.model === "string" ? o.model : null, o.system, [{ role: "user", content: o.user }], o.files ?? [], o.maxTokens, schema, o.signal ? AbortSignal.any([o.signal, timeout]) : timeout);
  let total = 0n;
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await collect(prepared.req);
    total += await record(o.kind, prepared.provider, prepared.modelId, result.usage);
    if (result.error !== null && result.error !== "bad_output") throw mapLlmError(result.error);
    const data = result.error === null ? parseJsonOutput(result.text, o.schema) : null;
    if (data !== null) return { data, costMicros: total };
  }
  throw mapLlmError("bad_output");
}

// O(1)
function frameEvent(event: StreamEvent): Uint8Array {
  return enc.encode(`data:${JSON.stringify(event)}\n\n`);
}

// O(n) in the streamed text
// INV: a missing or disconnected model throws before the stream starts, so the route can answer with a status
export async function chatStream(o: StreamCall): Promise<ReadableStream<Uint8Array>> {
  const upstream = new AbortController();
  const settings = loadSettings(await localProfile());
  const prepared = await prepare(settings, taskForKind(o.kind, o.model), typeof o.model === "string" ? o.model : null, o.system, o.messages, [], o.maxTokens, null, AbortSignal.any([upstream.signal, o.signal, AbortSignal.timeout(settings.limits.timeoutSeconds * 1000)]));
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
    let usage: UsageSeen | null = null;
    let text = "";
    let shown = 0;
    try {
      for await (const event of providerAdapter(prepared.req.model.provider).stream(prepared.req)) {
        if (event.type === "text") {
          text += event.delta;
          const end = visibleLength(text, o.hideFrom, shown);
          if (end > shown) send(ctrl, frameEvent({ t: "d", v: text.slice(shown, end) }));
          shown = Math.max(shown, end);
        } else if (event.type === "usage") usage = { inputTokens: event.inputTokens, outputTokens: event.outputTokens, costUsd: event.costUsd };
        else if (event.type === "error") throw mapLlmError(event.code);
      }
      const end = await o.onDone(text, () => send(ctrl, frameEvent({ t: "prep" })));
      send(ctrl, frameEvent({ t: "end", ...end }));
    } catch (error) {
      if (!o.signal.aborted) {
        const code: ErrorCode = error instanceof HttpError ? error.code : "internal";
        if (!(error instanceof HttpError)) console.error("llm: stream failed");
        send(ctrl, frameEvent({ t: "err", code }));
      }
    } finally {
      await record(o.kind, prepared.provider, prepared.modelId, usage).catch(() => console.error("llm: usage record failed"));
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
