import { mapCodexFailure } from "./codexParse.ts";
import type { LlmEvent } from "./types.ts";

const QUIET_TYPES = new Set(["available_commands", "thought", "end", "plan", "current_mode_update"]);

export type GrokLine = { events: LlmEvent[]; abort: boolean; toolType: string | null; finished: boolean };

// O(1)
function readGrokCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.trunc(value) : 0;
}

// O(n) in the line
// SEC: any tool call (local or xAI server-side, e.g. X search) aborts; its input is never logged
export function parseGrokLine(line: string): GrokLine {
  const empty: GrokLine = { events: [], abort: false, toolType: null, finished: false };
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
  const type = typeof rec.type === "string" ? rec.type : "unknown";
  if (type === "text") return typeof rec.data === "string" && rec.data.length > 0 ? { ...empty, events: [{ type: "text", delta: rec.data }] } : empty;
  if (type === "end") return { ...empty, finished: true };
  if (type === "usage") {
    const usage = rec.usage;
    if (usage === undefined || usage === null || typeof usage !== "object") return empty;
    const row = usage as Record<string, unknown>;
    return { ...empty, events: [{ type: "usage", inputTokens: readGrokCount(row.input_tokens) + readGrokCount(row.cache_read_input_tokens), outputTokens: readGrokCount(row.output_tokens), costUsd: null }] };
  }
  if (type === "error") return { ...empty, events: [{ type: "error", code: mapCodexFailure(typeof rec.message === "string" ? rec.message : "") }] };
  if (QUIET_TYPES.has(type)) return empty;
  return { events: [{ type: "error", code: "provider_error" }], abort: true, toolType: type, finished: false };
}

// O(n) in the JSONL
export function collectGrokEvents(jsonl: string): { events: LlmEvent[]; aborted: boolean } {
  const events: LlmEvent[] = [];
  for (const line of jsonl.split("\n")) {
    const parsed = parseGrokLine(line);
    events.push(...parsed.events);
    if (parsed.abort) return { events, aborted: true };
  }
  return { events, aborted: false };
}

// O(n) in the output
// INV: `grok models` exits 0 even when signed out; only its "You are logged in" line means a usable session
export function parseGrokModels(text: string): { loggedIn: boolean; ids: string[] } {
  const loggedIn = /^You are logged in\b/m.test(text);
  const ids: string[] = [];
  for (const line of text.split("\n")) {
    const match = /^\s*[*-]\s+([A-Za-z0-9._-]{1,100})(?:\s|$)/.exec(line);
    if (match?.[1] !== undefined) ids.push(match[1]);
  }
  return { loggedIn, ids };
}
