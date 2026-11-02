import type { LlmErrorCode, LlmEvent } from "./types.ts";

const SAFE_ITEMS = new Set(["agent_message", "reasoning", "error"]);

export type CodexLine = { events: LlmEvent[]; abort: boolean; toolType: string | null; ignoreType: string | null };

// O(1)
function numberOf(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.trunc(value) : 0;
}

// O(n) in the message
export function mapCodexFailure(message: string): LlmErrorCode {
  const text = message.toLowerCase();
  if (text.includes("usage limit") || text.includes("usage_limit") || text.includes("quota") || text.includes("insufficient") || text.includes("billing")) return "quota_exhausted";
  if (text.includes("rate limit") || text.includes("rate_limit") || text.includes("too many")) return "rate_limited";
  if (text.includes("not supported") || text.includes("unknown model") || text.includes("does not exist") || text.includes("model metadata")) return "model_unavailable";
  if (text.includes("logged out") || text.includes("not logged") || text.includes("sign in") || text.includes("login")) return "not_connected";
  return "provider_error";
}

// O(1)
function failureMessage(rec: Record<string, unknown>): string {
  const error = rec.error;
  if (error !== undefined && typeof error === "object") {
    const message = (error as Record<string, unknown>).message;
    if (typeof message === "string") return message;
  }
  return typeof rec.message === "string" ? rec.message : "";
}

// O(1)
function itemOf(rec: Record<string, unknown>): Record<string, unknown> | null {
  const item = rec.item;
  if (item === undefined || typeof item !== "object") return null;
  return item as Record<string, unknown>;
}

// O(n) in the line
// SEC: a tool or command item is reported by type only; its command text is dropped
export function parseCodexLine(line: string): CodexLine {
  const empty: CodexLine = { events: [], abort: false, toolType: null, ignoreType: null };
  const trimmed = line.trim();
  if (trimmed.length === 0) return empty;
  let raw: unknown;
  try {
    raw = JSON.parse(trimmed);
  } catch {
    return empty;
  }
  if (raw === null || typeof raw !== "object") return empty;
  const rec = raw as Record<string, unknown>;
  const type = rec.type;
  if (type === "item.started" || type === "item.updated" || type === "item.completed") {
    const item = itemOf(rec);
    const itemType = item === null || typeof item.type !== "string" ? "unknown" : item.type;
    if (!SAFE_ITEMS.has(itemType)) return { events: [{ type: "error", code: "provider_error" }], abort: true, toolType: itemType, ignoreType: null };
    if (type === "item.completed" && itemType === "error") return { events: [], abort: false, toolType: null, ignoreType: "error" };
    if (type === "item.completed" && itemType === "agent_message" && item !== null && typeof item.text === "string" && item.text.length > 0) {
      return { events: [{ type: "text", delta: item.text }], abort: false, toolType: null, ignoreType: null };
    }
    return empty;
  }
  if (type === "turn.completed") {
    const usage = rec.usage;
    if (usage === undefined || typeof usage !== "object") return empty;
    const row = usage as Record<string, unknown>;
    return { events: [{ type: "usage", inputTokens: numberOf(row.input_tokens), outputTokens: numberOf(row.output_tokens), costUsd: null }], abort: false, toolType: null, ignoreType: null };
  }
  if (type === "turn.failed" || type === "error") return { events: [{ type: "error", code: mapCodexFailure(failureMessage(rec)) }], abort: false, toolType: null, ignoreType: null };
  return empty;
}

// O(n) in the JSONL
export function collectCodexEvents(jsonl: string): { events: LlmEvent[]; aborted: boolean } {
  const events: LlmEvent[] = [];
  for (const line of jsonl.split("\n")) {
    const parsed = parseCodexLine(line);
    events.push(...parsed.events);
    if (parsed.abort) return { events, aborted: true };
  }
  return { events, aborted: false };
}
