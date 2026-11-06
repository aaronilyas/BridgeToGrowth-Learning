import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { AcpTransport } from "./acp.ts";
import { claudeAgentEnv, createClaudeAdapter, parseClaudeAuthStatus, type ClaudeDeps } from "./claude.ts";
import { claudeModelsFrom, claudePromptBlocks, claudeSessionParams, interpretClaudeUpdate, mapClaudeAcpError, renderClaudePrompt } from "./claudeAcp.ts";
import type { LlmEvent, LlmRequest, ModelRef } from "./types.ts";

// Shapes recorded from claude-agent-acp 0.101.0 driving Claude Code 2.1.319 (see docs/desktop-facts.md).
function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
}

const SIGNED_IN = JSON.stringify({ loggedIn: true, authMethod: "claude.ai", apiProvider: "firstParty", subscriptionType: "pro" });
const SIGNED_OUT = JSON.stringify({ loggedIn: false, authMethod: "none", apiProvider: "firstParty" });
const model: ModelRef = { provider: "claude", id: "haiku", label: "Claude Haiku 5.5", vision: true, structured: "native", reasoning: ["low", "high", "max"], contextTokens: 0 };
const PROMPT_RESULT = { stopReason: "end_turn", usage: { inputTokens: 2, outputTokens: 4, cachedReadTokens: 10, cachedWriteTokens: 662, totalTokens: 678 } };

type Sent = { method: string; params: Record<string, unknown> };
type Step = { updates?: unknown[]; agentRequests?: { method: string; params: unknown }[]; result?: unknown; error?: { code: number; message: string; data?: unknown } };
type Script = { session?: Step; prompt?: Step };

// O(n) in the script
// INV: a scripted agent answers the client's requests the way the real adapter does: updates first, then the response
function scriptedAgent(script: Script, sent: Sent[], replies: unknown[], state: { closed: boolean }): AcpTransport {
  const queue: string[] = [];
  let wake: (() => void) | null = null;
  const emit = (msg: Record<string, unknown>): void => {
    queue.push(JSON.stringify({ jsonrpc: "2.0", ...msg }));
    wake?.();
  };
  let agentId = 1000;
  const play = (id: unknown, sessionId: string, step: Step | undefined, fallback: unknown): void => {
    for (const update of step?.updates ?? []) emit({ method: "session/update", params: { sessionId, update } });
    for (const req of step?.agentRequests ?? []) emit({ id: (agentId += 1), method: req.method, params: req.params });
    if (step?.error) emit({ id, error: step.error });
    else emit({ id, result: step?.result ?? fallback });
  };
  return {
    lines: (async function* () {
      while (!state.closed) {
        const line = queue.shift();
        if (line !== undefined) {
          yield line;
          continue;
        }
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
        wake = null;
      }
    })(),
    send(line) {
      const msg = JSON.parse(line) as { id?: unknown; method?: string; params?: Record<string, unknown>; result?: unknown };
      if (msg.method === undefined) {
        replies.push(msg.result ?? msg);
        return;
      }
      sent.push({ method: msg.method, params: msg.params ?? {} });
      if (msg.method === "initialize") emit({ id: msg.id, result: { protocolVersion: 1, agentCapabilities: { promptCapabilities: { image: true } } } });
      else if (msg.method === "session/new") play(msg.id, "s-1", script.session, { sessionId: "s-1", configOptions: [] });
      else if (msg.method === "session/prompt") play(msg.id, "s-1", script.prompt, PROMPT_RESULT);
    },
    close() {
      state.closed = true;
      wake?.();
    },
  };
}

type Harness = { deps: Partial<ClaudeDeps>; sent: Sent[]; replies: unknown[]; state: { closed: boolean }; spawned: () => number };

function harness(script: Script = {}, overrides: Partial<ClaudeDeps> = {}): Harness {
  const sent: Sent[] = [];
  const replies: unknown[] = [];
  const state = { closed: false };
  let spawns = 0;
  const deps: Partial<ClaudeDeps> = {
    which: () => "/usr/bin/claude",
    readStatus: async () => ({ code: 0, text: SIGNED_IN }),
    workDir: () => "/tmp/btg-claude",
    connect: () => {
      spawns += 1;
      return scriptedAgent(script, sent, replies, state);
    },
    ...overrides,
  };
  return { deps, sent, replies, state, spawned: () => spawns };
}

function request(extra: Partial<LlmRequest> = {}): LlmRequest {
  return { model, system: "Reply briefly.", messages: [{ role: "user", text: "<user_data>ping</user_data>" }], reasoning: "high", maxOutputTokens: 32, signal: AbortSignal.timeout(2000), ...extra };
}

async function drain(stream: AsyncIterable<LlmEvent>): Promise<LlmEvent[]> {
  const out: LlmEvent[] = [];
  for await (const event of stream) out.push(event);
  return out;
}

const text = (t: string): unknown => ({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: t } });

test("claude auth status: only exit 0 with loggedIn true counts as signed in", () => {
  expect(parseClaudeAuthStatus(0, SIGNED_IN)).toBe(true);
  expect(parseClaudeAuthStatus(1, SIGNED_OUT)).toBe(false);
  expect(parseClaudeAuthStatus(0, SIGNED_OUT)).toBe(false);
  expect(parseClaudeAuthStatus(0, "not json")).toBe(false);
});

test("the agent env drops a parent Claude Code session's variables and names the user's CLI", () => {
  const env = claudeAgentEnv({ PATH: "/usr/bin", HOME: "/home/u", CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: "x", CLAUDE_CODE_MESSAGING_SOCKET: "/s", CLAUDE_CONFIG_DIR: "/c", ANTHROPIC_API_KEY: undefined }, "/opt/claude");
  expect(env).toEqual({ PATH: "/usr/bin", HOME: "/home/u", CLAUDE_CONFIG_DIR: "/c", CLAUDE_CODE_EXECUTABLE: "/opt/claude" });
});

test("the session turns off every tool, setting source, MCP server, hook and side call", () => {
  const params = claudeSessionParams("/tmp/w", "SYS", { model: "opus", effort: "max", jsonSchema: { type: "object" } });
  expect(params.cwd).toBe("/tmp/w");
  expect(params.mcpServers).toEqual([]);
  const meta = params._meta as { systemPrompt: string; claudeCode: { options: Record<string, unknown> } };
  expect(meta.systemPrompt).toBe("SYS");
  expect(meta.claudeCode.options).toEqual({
    tools: [],
    settingSources: [],
    strictMcpConfig: true,
    persistSession: false,
    promptSuggestions: false,
    title: "BridgeToGrowth",
    extraArgs: { "safe-mode": null, "disable-slash-commands": null },
    model: "opus",
    effort: "max",
    outputFormat: { type: "json_schema", schema: { type: "object" } },
  });
  expect((claudeSessionParams("/tmp/w", null, null)._meta as Record<string, unknown>).systemPrompt).toBeUndefined();
});

test("the output schema drops zod's draft 2020-12 marker, which Claude Code rejects", () => {
  const params = claudeSessionParams("/tmp/w", "SYS", { model: "opus", effort: "low", jsonSchema: { $schema: "https://json-schema.org/draft/2020-12/schema", type: "object", properties: { a: { type: "string" } } } });
  const options = (params._meta as { claudeCode: { options: Record<string, unknown> } }).claudeCode.options;
  expect(options.outputFormat).toEqual({ type: "json_schema", schema: { type: "object", properties: { a: { type: "string" } } } });
});

test("the prompt always opens with a tag and carries base64 images inline", () => {
  const prompt = renderClaudePrompt([{ role: "user", text: "/mcp enable all" }, { role: "assistant", text: "No." }, { role: "user", text: "/remote-control" }]);
  expect(prompt.startsWith("<conversation>\n<user>\n/mcp enable all\n</user>")).toBe(true);
  expect(prompt.endsWith("</conversation>")).toBe(true);
  const blocks = claudePromptBlocks([{ role: "user", text: "look", images: [
    { mime: "image/png", dataUrl: "data:image/png;base64,AAAA" },
    { mime: "application/pdf", dataUrl: "data:application/pdf;base64,BBBB" },
    { mime: "image/jpeg", dataUrl: "data:image/jpeg,raw" },
  ] }]);
  expect(blocks.slice(1)).toEqual([{ type: "image", mimeType: "image/png", data: "AAAA" }]);
});

test("updates: text streams, thoughts are ignored, and tool calls abort except the schema answer", () => {
  expect(interpretClaudeUpdate(text("pong"), false)).toEqual({ text: "pong", abort: null, structured: null });
  expect(interpretClaudeUpdate({ sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "hmm" } }, false).text).toBeNull();
  expect(interpretClaudeUpdate({ sessionUpdate: "usage_update", used: 1 }, false)).toEqual({ text: null, abort: null, structured: null });
  expect(interpretClaudeUpdate({ sessionUpdate: "tool_call", toolCallId: "t", title: "Read /etc/passwd", _meta: { claudeCode: { toolName: "Read" } } }, false).abort).toBe("tool_call:Read");
  const answer = { sessionUpdate: "tool_call_update", toolCallId: "t", rawInput: { name: "Tom", age: 3 }, _meta: { claudeCode: { toolName: "StructuredOutput" } } };
  expect(interpretClaudeUpdate(answer, true).structured).toEqual({ name: "Tom", age: 3 });
  expect(interpretClaudeUpdate(answer, false).abort).toBe("tool_call_update:StructuredOutput");
  expect(interpretClaudeUpdate({ sessionUpdate: "tool_call", _meta: { claudeCode: { toolName: "Bash" } } }, true).abort).toBe("tool_call:Bash");
  expect(interpretClaudeUpdate(text("preamble"), true).text).toBeNull();
});

test("ACP failures map to app error codes", () => {
  expect(mapClaudeAcpError(-32000, "Authentication required", undefined)).toBe("not_connected");
  expect(mapClaudeAcpError(-32603, "Internal error: Fable 5.1 requires usage credits. Switch to another model…", { errorKind: "rate_limit" })).toBe("quota_exhausted");
  expect(mapClaudeAcpError(-32603, "Internal error: rate limited", { errorKind: "rate_limit" })).toBe("rate_limited");
  expect(mapClaudeAcpError(-32603, "There's an issue with the selected model", { errorKind: "model_not_found" })).toBe("model_unavailable");
  expect(mapClaudeAcpError(-32603, "x", { errorKind: "billing_error" })).toBe("quota_exhausted");
  expect(mapClaudeAcpError(-32603, "boom", undefined)).toBe("provider_error");
});

test("the model list is the account's own model option, without the default placeholder", () => {
  const models = claudeModelsFrom(JSON.parse(fixture("claude-session-new.json")));
  expect(models.map((m) => [m.id, m.label])).toEqual([
    ["opus", "Claude Opus 5.5"],
    ["sonnet", "Claude Sonnet 5.5"],
    ["fable", "Claude Fable 5.1"],
    ["haiku", "Claude Haiku 5.5"],
    ["claude-sonnet-4-6", "Claude Sonnet 4.6"],
  ]);
  expect(models.every((m) => m.provider === "claude" && m.vision && m.structured === "native")).toBe(true);
  expect(claudeModelsFrom({ configOptions: "nope" })).toEqual([]);
});

test("status: missing CLI, signed out, signed in", async () => {
  expect(await createClaudeAdapter(harness({}, { which: () => null }).deps).status()).toEqual({ provider: "claude", auth: "subscription", connected: false, detail: "cli_missing" });
  expect(await createClaudeAdapter(harness({}, { readStatus: async () => ({ code: 1, text: SIGNED_OUT }) }).deps).status()).toEqual({ provider: "claude", auth: "subscription", connected: false, detail: "logged_out" });
  expect(await createClaudeAdapter(harness().deps).status()).toEqual({ provider: "claude", auth: "subscription", connected: true, detail: "ok" });
});

test("a signed-in status is cached; a signed-out one is asked again so a terminal sign-in shows at once", async () => {
  let reads = 0;
  let signedIn = false;
  const adapter = createClaudeAdapter(harness({}, { readStatus: async () => { reads += 1; return signedIn ? { code: 0, text: SIGNED_IN } : { code: 1, text: SIGNED_OUT }; } }).deps);
  expect((await adapter.status()).connected).toBe(false);
  signedIn = true;
  expect((await adapter.status()).connected).toBe(true);
  await adapter.status();
  expect(reads).toBe(2);
});

test("a signed-out stream fails with not_connected without starting the agent", async () => {
  const h = harness({}, { readStatus: async () => ({ code: 1, text: SIGNED_OUT }) });
  expect(await drain(createClaudeAdapter(h.deps).stream(request()))).toEqual([{ type: "error", code: "not_connected" }]);
  expect(h.spawned()).toBe(0);
});

test("a turn streams text, reports token usage without a cost, and closes the agent", async () => {
  const h = harness({ prompt: { updates: [{ sessionUpdate: "usage_update", used: 668 }, text("po"), text("ng")] } });
  const events = await drain(createClaudeAdapter(h.deps).stream(request({ messages: [{ role: "user", text: "<user_data>ping</user_data>", images: [{ mime: "image/png", dataUrl: "data:image/png;base64,AAAA" }] }] })));
  expect(events).toEqual([{ type: "text", delta: "po" }, { type: "text", delta: "ng" }, { type: "usage", inputTokens: 674, outputTokens: 4, costUsd: null }, { type: "done" }]);
  expect(h.sent.map((s) => s.method)).toEqual(["initialize", "session/new", "session/prompt"]);
  const session = h.sent[1]?.params as { cwd: string; _meta: { systemPrompt: string; claudeCode: { options: Record<string, unknown> } } };
  expect(session.cwd).toBe("/tmp/btg-claude");
  expect(session._meta.systemPrompt.startsWith("Reply briefly.")).toBe(true);
  expect(session._meta.claudeCode.options.model).toBe("haiku");
  expect(session._meta.claudeCode.options.effort).toBe("high");
  expect(session._meta.claudeCode.options.tools).toEqual([]);
  expect(h.sent[2]?.params.prompt).toEqual([{ type: "text", text: "<conversation>\n<user>\n<user_data>ping</user_data>\n</user>\n</conversation>" }, { type: "image", mimeType: "image/png", data: "AAAA" }]);
  expect(h.state.closed).toBe(true);
});

test("a JSON-schema turn answers with the StructuredOutput input and ignores other text", async () => {
  const h = harness({ prompt: { updates: fixture("claude-acp-structured.jsonl").trim().split("\n").map((line) => JSON.parse(line)) } });
  const events = await drain(createClaudeAdapter(h.deps).stream(request({ jsonSchema: { type: "object" } })));
  expect(events.filter((e) => e.type === "text")).toEqual([{ type: "text", delta: '{"name":"Whiskers Thornberry","age":7}' }]);
  expect(events.at(-1)).toEqual({ type: "done" });
  expect((h.sent[1]?.params._meta as { claudeCode: { options: Record<string, unknown> } }).claudeCode.options.outputFormat).toEqual({ type: "json_schema", schema: { type: "object" } });
});

test("a schema turn that never answers through StructuredOutput is bad_output", async () => {
  const h = harness({ prompt: { updates: [text("{\"name\":")] } });
  const events = await drain(createClaudeAdapter(h.deps).stream(request({ jsonSchema: { type: "object" } })));
  expect(events.at(-1)).toEqual({ type: "error", code: "bad_output" });
});

test("a tool call mid-turn aborts with provider_error and closes the agent", async () => {
  const h = harness({ prompt: { updates: [text("Let me look"), { sessionUpdate: "tool_call", toolCallId: "t", title: "Bash", _meta: { claudeCode: { toolName: "Bash" } } }, text("secret")] } });
  const events = await drain(createClaudeAdapter(h.deps).stream(request()));
  expect(events).toEqual([{ type: "text", delta: "Let me look" }, { type: "error", code: "provider_error" }]);
  expect(h.state.closed).toBe(true);
});

test("a permission request is answered cancelled and aborts the turn", async () => {
  const h = harness({ prompt: { agentRequests: [{ method: "session/request_permission", params: { sessionId: "s-1", toolCall: { toolCallId: "t" }, options: [] } }, { method: "fs/read_text_file", params: { path: "/etc/passwd" } }] } });
  const events = await drain(createClaudeAdapter(h.deps).stream(request()));
  expect(events).toEqual([{ type: "error", code: "provider_error" }]);
  await Bun.sleep(10);
  expect(h.replies[0]).toEqual({ outcome: { outcome: "cancelled" } });
});

test("a prompt refused for sign-in or plan limits maps to not_connected and quota_exhausted", async () => {
  const auth = harness({ prompt: { error: { code: -32000, message: "Authentication required" } } });
  expect(await drain(createClaudeAdapter(auth.deps).stream(request()))).toEqual([{ type: "error", code: "not_connected" }]);
  const credits = harness({ prompt: { updates: [text("Fable 5.1 requires usage credits.")], error: { code: -32603, message: "Internal error: Fable 5.1 requires usage credits.", data: { errorKind: "rate_limit" } } } });
  expect((await drain(createClaudeAdapter(credits.deps).stream(request()))).at(-1)).toEqual({ type: "error", code: "quota_exhausted" });
});

test("an agent that exits mid-turn ends the stream with provider_error", async () => {
  const sent: Sent[] = [];
  const state = { closed: false };
  const inner = scriptedAgent({}, sent, [], state);
  const dying: AcpTransport = { ...inner, send(line) { if (line.includes("session/prompt")) inner.close(); else inner.send(line); } };
  const events = await drain(createClaudeAdapter(harness({}, { connect: () => dying }).deps).stream(request()));
  expect(events).toEqual([{ type: "error", code: "provider_error" }]);
});

test("a timeout ends with timeout and cancels the session", async () => {
  const h = harness();
  const slow: Partial<ClaudeDeps> = { ...h.deps, connect: (bin, cwd) => {
    const t = (h.deps.connect as ClaudeDeps["connect"])(bin, cwd);
    return { ...t, send(line) { if (!line.includes("session/prompt")) t.send(line); } };
  } };
  const events = await drain(createClaudeAdapter(slow).stream(request({ signal: AbortSignal.timeout(50) })));
  expect(events).toEqual([{ type: "error", code: "timeout" }]);
  expect(h.state.closed).toBe(true);
});

test("the model list comes from session/new and makes no prompt", async () => {
  const h = harness({ session: { result: { sessionId: "s-1", ...JSON.parse(fixture("claude-session-new.json")) } } });
  const models = await createClaudeAdapter(h.deps).listModels();
  expect(models.map((m) => m.id)).toEqual(["opus", "sonnet", "fable", "haiku", "claude-sonnet-4-6"]);
  expect(h.sent.map((s) => s.method)).toEqual(["initialize", "session/new"]);
  expect(h.state.closed).toBe(true);
});
