import { parseSseChunk } from "../../../shared/sse.ts";
import type { ChatMessage, LlmErrorCode, LlmEvent, LlmRequest } from "./types.ts";

type Part = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } } | { type: "file"; file: { filename: string; file_data: string } };

// O(1)
export function providerHttpCode(status: number): LlmErrorCode {
  if (status === 401 || status === 403) return "auth_expired";
  if (status === 429) return "rate_limited";
  if (status === 402) return "quota_exhausted";
  if (status === 404) return "model_unavailable";
  return "provider_error";
}

// O(1)
export function providerHttpDetail(status: number): "key_invalid" | "unreachable" {
  return status === 401 || status === 403 ? "key_invalid" : "unreachable";
}

// O(1)
function numberOf(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.trunc(value) : 0;
}

// O(n) in the message's images
function contentOf(message: ChatMessage): string | Part[] {
  const images = message.images ?? [];
  if (images.length === 0) return message.text;
  const parts: Part[] = [{ type: "text", text: message.text }];
  for (const image of images) {
    if (image.mime.startsWith("image/")) parts.push({ type: "image_url", image_url: { url: image.dataUrl } });
    else parts.push({ type: "file", file: { filename: "attachment", file_data: image.dataUrl } });
  }
  return parts;
}

// O(n) in messages
// SEC: the body is model, messages, max_tokens, and optional json schema or reasoning; tool fields are never set
export function buildOpenAiChatBody(req: LlmRequest, includeUsage: boolean, reasoning: "openrouter" | "xai" | "none"): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: req.model.id,
    messages: [{ role: "system", content: req.system }, ...req.messages.map((message) => ({ role: message.role, content: contentOf(message) }))],
    max_tokens: req.maxOutputTokens,
    stream: true,
  };
  if (includeUsage) body.usage = { include: true };
  if (req.jsonSchema) body.response_format = { type: "json_schema", json_schema: { name: "output", strict: true, schema: req.jsonSchema } };
  if (reasoning === "openrouter" && req.model.reasoning.length > 0) body.reasoning = { effort: req.reasoning };
  if (reasoning === "xai" && req.model.reasoning.length > 0) body.reasoning_effort = req.reasoning === "low" ? "low" : "high";
  return body;
}

// O(1)
export function openAiDataEvents(raw: unknown): LlmEvent[] {
  if (raw === null || typeof raw !== "object") return [];
  const rec = raw as Record<string, unknown>;
  if (rec.error !== undefined) return [{ type: "error", code: "provider_error" }];
  const out: LlmEvent[] = [];
  const choices = rec.choices;
  if (Array.isArray(choices)) {
    const first = choices[0];
    if (first !== undefined && typeof first === "object") {
      const delta = (first as Record<string, unknown>).delta;
      if (delta !== undefined && typeof delta === "object") {
        const text = (delta as Record<string, unknown>).content;
        if (typeof text === "string" && text.length > 0) out.push({ type: "text", delta: text });
      }
    }
  }
  const usage = rec.usage;
  if (usage !== undefined && typeof usage === "object") {
    const row = usage as Record<string, unknown>;
    const cost = typeof row.cost === "number" && Number.isFinite(row.cost) && row.cost >= 0 ? row.cost : null;
    out.push({ type: "usage", inputTokens: numberOf(row.prompt_tokens), outputTokens: numberOf(row.completion_tokens), costUsd: cost });
  }
  return out;
}

// O(1) plus the round trip
// SEC: the bearer token is sent only on this request and is never logged
export async function probeBearer(url: string, key: string, fetchFn: typeof fetch): Promise<"ok" | "invalid" | "unreachable"> {
  try {
    const res = await fetchFn(url, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(10_000) });
    await res.body?.cancel();
    if (res.ok) return "ok";
    return res.status === 401 || res.status === 403 ? "invalid" : "unreachable";
  } catch {
    return "unreachable";
  }
}

// O(n) in the streamed response
// SEC: an abort cancels the fetch; upstream bodies are not logged
export async function* streamOpenAiChat(url: string, key: string, body: Record<string, unknown>, signal: AbortSignal, fetchFn: typeof fetch, extraHeaders: Record<string, string> = {}): AsyncIterable<LlmEvent> {
  let res: Response;
  try {
    res = await fetchFn(url, { method: "POST", signal, headers: { authorization: `Bearer ${key}`, "content-type": "application/json", ...extraHeaders }, body: JSON.stringify(body) });
  } catch {
    const reason: unknown = signal.reason;
    if (signal.aborted && reason instanceof DOMException && reason.name === "TimeoutError") yield { type: "error", code: "timeout" };
    else if (!signal.aborted) yield { type: "error", code: "provider_error" };
    return;
  }
  if (!res.ok || res.body === null) {
    await res.body?.cancel();
    yield { type: "error", code: providerHttpCode(res.status) };
    return;
  }
  yield* readOpenAiSse(res.body);
}

// O(n) in the response body
export async function* readOpenAiSse(body: ReadableStream<Uint8Array>): AsyncIterable<LlmEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      const parsed = parseSseChunk(buf + decoder.decode(chunk.value, { stream: true }));
      buf = parsed.rest;
      for (const event of parsed.events) yield* openAiDataEvents(event);
    }
  } finally {
    reader.releaseLock();
  }
  yield { type: "done" };
}
