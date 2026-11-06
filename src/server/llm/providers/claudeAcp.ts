// Claude through ACP: the pinned claude-agent-acp adapter, driving the user's own signed-in Claude Code CLI.
import { mapCodexFailure } from "./codexParse.ts";
import type { ChatMessage, LlmErrorCode, LlmEvent, LlmRequest, ModelRef, ReasoningLevel } from "./types.ts";
import { ACP_AUTH_REQUIRED, ACP_PROTOCOL_VERSION } from "./acp.ts";

const STRUCTURED_TOOL = "StructuredOutput";
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const REASONING: readonly ReasoningLevel[] = ["low", "high", "max"];
const TRANSCRIPT_NOTE = "\n\nThe conversation so far is inside <conversation>. Write only the assistant's next reply, without the tags.";

export type ClaudeUpdate = { text: string | null; abort: string | null; structured: Record<string, unknown> | null };

// O(1)
function recordOf(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

// O(1)
export function claudeInitializeParams(): Record<string, unknown> {
  return { protocolVersion: ACP_PROTOCOL_VERSION, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false }, clientInfo: { name: "bridgetogrowth-learning", version: "1" } };
}

// O(1)
export function claudeEffortValue(level: ReasoningLevel): string {
  return level;
}

// O(n) in the top-level keys
// INV: Claude Code refuses a schema whose "$schema" names draft 2020-12 (zod's default), so the dialect marker is dropped; the schema itself is unchanged
export function claudeOutputSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const { $schema: _dialect, ...rest } = schema;
  return rest;
}

// O(n) in the schema
// SEC: every built-in tool, MCP server, setting file, hook, plugin and slash command is off; the session is not saved and makes no title or suggestion calls of its own
// INV: the system prompt replaces Claude Code's own entirely
export function claudeSessionParams(cwd: string, system: string | null, choice: { model: string; effort: string; jsonSchema?: Record<string, unknown> } | null): Record<string, unknown> {
  const options: Record<string, unknown> = {
    tools: [],
    settingSources: [],
    strictMcpConfig: true,
    persistSession: false,
    promptSuggestions: false,
    title: "BridgeToGrowth",
    extraArgs: { "safe-mode": null, "disable-slash-commands": null },
  };
  if (choice !== null) {
    options.model = choice.model;
    options.effort = choice.effort;
    if (choice.jsonSchema !== undefined) options.outputFormat = { type: "json_schema", schema: claudeOutputSchema(choice.jsonSchema) };
  }
  return { cwd, mcpServers: [], _meta: { ...(system === null ? {} : { systemPrompt: system }), claudeCode: { options } } };
}

// O(n) in the transcript
// SEC: the prompt always opens with a tag, so a user turn can never start it with a slash command
export function renderClaudePrompt(messages: readonly ChatMessage[]): string {
  const lines = ["<conversation>"];
  for (const message of messages) lines.push(`<${message.role}>`, message.text, `</${message.role}>`);
  lines.push("</conversation>");
  return lines.join("\n");
}

// O(n) in image bytes
// INV: images travel inline as ACP image blocks; nothing is written to disk
export function claudePromptBlocks(messages: readonly ChatMessage[]): Record<string, unknown>[] {
  const blocks: Record<string, unknown>[] = [{ type: "text", text: renderClaudePrompt(messages) }];
  for (const message of messages) {
    for (const image of message.images ?? []) {
      const marker = image.dataUrl.indexOf(",");
      if (!IMAGE_TYPES.has(image.mime) || !image.dataUrl.startsWith("data:") || marker < 0 || !image.dataUrl.slice(0, marker).endsWith(";base64")) continue;
      blocks.push({ type: "image", mimeType: image.mime, data: image.dataUrl.slice(marker + 1) });
    }
  }
  return blocks;
}

// O(1)
export function claudeSystemText(req: LlmRequest): string {
  return req.system + TRANSCRIPT_NOTE;
}

// O(1)
function toolNameOf(update: Record<string, unknown>): string {
  const claudeCode = recordOf(recordOf(update._meta)?.claudeCode);
  if (typeof claudeCode?.toolName === "string") return claudeCode.toolName;
  return typeof update.title === "string" ? update.title : "unknown";
}

// O(n) in the update
// SEC: a tool call aborts the turn; the one exception is the StructuredOutput call that carries the answer of a JSON-schema request
// INV: every other update (thoughts, usage, commands, titles, modes, plans) carries nothing for the answer and is ignored
export function interpretClaudeUpdate(rawUpdate: unknown, structured: boolean): ClaudeUpdate {
  const none: ClaudeUpdate = { text: null, abort: null, structured: null };
  const update = recordOf(rawUpdate);
  if (update === null) return none;
  const kind = typeof update.sessionUpdate === "string" ? update.sessionUpdate : "unknown";
  if (kind === "agent_message_chunk") {
    const content = recordOf(update.content);
    if (structured || content?.type !== "text" || typeof content.text !== "string" || content.text.length === 0) return none;
    return { ...none, text: content.text };
  }
  if (kind === "tool_call" || kind === "tool_call_update") {
    const tool = toolNameOf(update);
    if (!structured || tool !== STRUCTURED_TOOL) return { ...none, abort: `${kind}:${tool}` };
    return { ...none, structured: recordOf(update.rawInput) };
  }
  return none;
}

// O(1)
function readCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.trunc(value) : 0;
}

// O(1)
// INV: the adapter reports a cost figure, but on a Claude plan it is a list-price estimate rather than a bill, so cost stays unknown
export function claudeUsageEvent(result: unknown): LlmEvent | null {
  const usage = recordOf(recordOf(result)?.usage);
  if (usage === null) return null;
  return { type: "usage", inputTokens: readCount(usage.inputTokens) + readCount(usage.cachedReadTokens) + readCount(usage.cachedWriteTokens), outputTokens: readCount(usage.outputTokens), costUsd: null };
}

// O(1)
export function claudeStopReason(result: unknown): string {
  const reason = recordOf(result)?.stopReason;
  return typeof reason === "string" ? reason : "unknown";
}

// O(n) in the message
export function mapClaudeAcpError(code: number, message: string, data: unknown): LlmErrorCode {
  if (code === ACP_AUTH_REQUIRED) return "not_connected";
  const kind = recordOf(data)?.errorKind;
  const text = message.toLowerCase();
  if (kind === "authentication_failed") return "not_connected";
  if (kind === "billing_error") return "quota_exhausted";
  if (kind === "model_not_found") return "model_unavailable";
  if (kind === "rate_limit") return /credit|usage limit|limit reached|hit your limit|out of usage/.test(text) ? "quota_exhausted" : "rate_limited";
  return mapCodexFailure(message);
}

// O(n) in the catalog
// INV: the model list is the account's own "model" option from session/new, minus the account-default placeholder
export function claudeModelsFrom(sessionResult: unknown): ModelRef[] {
  const options = recordOf(sessionResult)?.configOptions;
  if (!Array.isArray(options)) return [];
  const select = options.map(recordOf).find((option) => option?.id === "model" || option?.category === "model");
  const values = select?.options;
  if (!Array.isArray(values)) return [];
  const out: ModelRef[] = [];
  for (const raw of values) {
    const value = recordOf(raw);
    if (value === null || typeof value.value !== "string" || value.value === "default" || value.value.length === 0 || value.value.length > 200) continue;
    const name = typeof value.name === "string" && value.name.length > 0 ? value.name.slice(0, 190) : value.value;
    out.push({ provider: "claude", id: value.value, label: `Claude ${name}`, vision: true, structured: "native", reasoning: REASONING, contextTokens: 0 });
  }
  return out;
}
