import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { CodexRun } from "./codexRun.ts";
import { parseGrokLoginText } from "./grokLogin.ts";
import { collectGrokEvents, parseGrokLine, parseGrokModels } from "./grokParse.ts";
import { grokEffortValue, grokExecArgv } from "./grokRun.ts";
import { createSpaceXaiAdapter, type SpaceXaiDeps } from "./spacexai.ts";
import type { LlmEvent, LlmRequest, ModelRef } from "./types.ts";

function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
}

const SIGNED_IN = "You are logged in with grok.com.\n\nDefault model: grok-4.7\n\nAvailable models:\n  * grok-4.7 (default)\n  - grok-4.7-build-fast\n  - grok-4.6\n";
const SIGNED_OUT = "You are not authenticated.\n\nDefault model: grok-4.6\n\nAvailable models:\n  * grok-4.6 (default)\n  - grok-4.5\n";

const model: ModelRef = { provider: "spacexai", id: "grok-4.7", label: "Grok 4.7", vision: false, structured: "native", reasoning: ["low", "high", "max"], contextTokens: 0 };

function request(extra: Partial<LlmRequest> = {}): LlmRequest {
  return { model, system: "Reply briefly.", messages: [{ role: "user", text: "<user_data>ping</user_data>", images: [{ mime: "image/png", dataUrl: "data:image/png;base64,AAAA" }] }], reasoning: "low", maxOutputTokens: 32, signal: AbortSignal.timeout(2000), ...extra };
}

type Recorded = { argv: readonly string[]; cwd: string; prompt: string; stopped: boolean };

function scripted(jsonl: string, rec: Recorded[]): SpaceXaiDeps["run"] {
  return (argv, _prompt, _signal, cwd): CodexRun => {
    const promptIndex = argv.indexOf("--prompt-file");
    const promptPath = argv[promptIndex + 1] ?? "";
    const row: Recorded = { argv, cwd, prompt: readFileSync(promptPath, "utf8"), stopped: false };
    rec.push(row);
    return { lines: (async function* () { for (const line of jsonl.split("\n")) yield line; })(), stop: () => { row.stopped = true; } };
  };
}

function noFetch(): typeof fetch {
  return Object.assign(async (): Promise<Response> => { throw new Error("network used"); }, { preconnect: () => undefined });
}

function deps(overrides: Partial<SpaceXaiDeps>): Partial<SpaceXaiDeps> {
  return { fetchFn: noFetch(), which: () => "/usr/bin/grok", readModels: async () => SIGNED_IN, readKey: async () => null, ...overrides };
}

async function drain(stream: AsyncIterable<LlmEvent>): Promise<LlmEvent[]> {
  const out: LlmEvent[] = [];
  for await (const event of stream) out.push(event);
  return out;
}

test("the recorded structured run maps text deltas and sums cached input tokens", () => {
  const parsed = collectGrokEvents(fixture("grok-text.jsonl"));
  expect(parsed.aborted).toBe(false);
  expect(parsed.events).toEqual([
    { type: "text", delta: "{\"" },
    { type: "text", delta: "city" },
    { type: "text", delta: "\":\"Paris\"}" },
    { type: "usage", inputTokens: 13935, outputTokens: 66, costUsd: null },
  ]);
  expect(parseGrokLine('{"type":"end","stopReason":"end_turn"}').finished).toBe(true);
});

test("a server-side X search tool call aborts before later text", () => {
  const parsed = collectGrokEvents(fixture("grok-tool.jsonl"));
  expect(parsed.aborted).toBe(true);
  expect(parsed.events).toEqual([{ type: "text", delta: "Searching" }, { type: "error", code: "provider_error" }]);
  expect(parseGrokLine('{"type":"tool_call","rawInput":{"command":"rm -rf /"}}').toolType).toBe("tool_call");
});

test("unknown event types abort, while noise and bad JSON are ignored", () => {
  expect(parseGrokLine('{"type":"brand_new_event"}').abort).toBe(true);
  expect(parseGrokLine("not json").events).toEqual([]);
  expect(parseGrokLine("").abort).toBe(false);
  expect(parseGrokLine('{"type":"thought","data":"hmm"}').events).toEqual([]);
  expect(parseGrokLine('{"type":"text","data":""}').events).toEqual([]);
});

test("CLI errors map to app error codes", () => {
  expect(collectGrokEvents(fixture("grok-signed-out.jsonl")).events).toEqual([{ type: "error", code: "not_connected" }]);
  expect(parseGrokLine(`{"type":"error","message":"Couldn't set model 'x': Invalid params: \\"unknown model id\\"."}`).events).toEqual([{ type: "error", code: "model_unavailable" }]);
  expect(parseGrokLine('{"type":"error","message":"rate limit reached"}').events).toEqual([{ type: "error", code: "rate_limited" }]);
});

test("grok models output gives sign-in state and model ids", () => {
  expect(parseGrokModels(SIGNED_IN)).toEqual({ loggedIn: true, ids: ["grok-4.7", "grok-4.7-build-fast", "grok-4.6"] });
  expect(parseGrokModels(SIGNED_OUT)).toEqual({ loggedIn: false, ids: ["grok-4.6", "grok-4.5"] });
  expect(parseGrokModels("")).toEqual({ loggedIn: false, ids: [] });
});

test("login text surfaces only xAI sign-in links and the confirmation code", () => {
  const device = "\nTo sign in, open this URL in your browser:\n\n  https://accounts.x.ai/oauth2/device?user_code=V3MJ-FGHR\n\nConfirm this code in your browser:\n\n  V3MJ-FGHR\n\n\x1b[90mOnly continue with a code you requested.\x1b[0m\n";
  expect(parseGrokLoginText(device)).toEqual({ url: "https://accounts.x.ai/oauth2/device?user_code=V3MJ-FGHR", code: "V3MJ-FGHR" });
  const browser = "Open this URL to sign in:\n  https://auth.x.ai/oauth2/authorize?response_type=code&client_id=abc\n";
  expect(parseGrokLoginText(browser)).toEqual({ url: "https://auth.x.ai/oauth2/authorize?response_type=code&client_id=abc", code: null });
  expect(parseGrokLoginText("open https://evil.example/x.ai/ then ABCD-EFGH")).toEqual({ url: null, code: null });
});

test("the headless argv removes tools, sandboxes the run and passes the schema", () => {
  const argv = grokExecArgv("/usr/bin/grok", request({ jsonSchema: { type: "object" } }), "/tmp/x", "/tmp/x/prompt.txt");
  const flag = (name: string): string | undefined => argv[argv.indexOf(name) + 1];
  expect(argv[0]).toBe("/usr/bin/grok");
  expect(flag("--prompt-file")).toBe("/tmp/x/prompt.txt");
  expect(flag("--output-format")).toBe("streaming-json");
  expect(flag("--permission-mode")).toBe("dontAsk");
  expect(flag("--sandbox")).toBe("strict");
  expect(flag("--max-turns")).toBe("1");
  expect(flag("--cwd")).toBe("/tmp/x");
  expect(flag("-m")).toBe("grok-4.7");
  expect(flag("--json-schema")).toBe('{"type":"object"}');
  expect(argv).toContain("--disable-web-search");
  expect(argv).toContain("--no-subagents");
  for (const tool of ["run_terminal_command", "read_file", "write", "search_replace", "web_fetch"]) expect(flag("--disallowed-tools")?.split(",")).toContain(tool);
  expect(argv).not.toContain("--always-approve");
  expect(grokEffortValue("low")).toBe("low");
  expect(grokEffortValue("max")).toBe("high");
});

test("a signed-in subscription is connected and wins over a stored key", async () => {
  let keyRead = false;
  const adapter = createSpaceXaiAdapter(deps({ readKey: async () => { keyRead = true; return "xai-key"; } }));
  expect(await adapter.status()).toEqual({ provider: "spacexai", auth: "subscription", connected: true, detail: "ok", subscription: "ok" });
  expect(keyRead).toBe(false);
  const models = await adapter.listModels();
  expect(models.map((m) => m.id)).toEqual(["grok-4.7", "grok-4.7-build-fast", "grok-4.6"]);
  expect(models.every((m) => m.provider === "spacexai" && !m.vision)).toBe(true);
});

test("signed out with a valid key falls back to the API key", async () => {
  const calls: string[] = [];
  const fetchFn = Object.assign(async (input: string | URL | Request): Promise<Response> => {
    calls.push(String(input));
    return Response.json({ data: [{ id: "grok-4.7" }] });
  }, { preconnect: () => undefined });
  const adapter = createSpaceXaiAdapter(deps({ readModels: async () => SIGNED_OUT, readKey: async () => "xai-key", fetchFn }));
  expect(await adapter.status()).toEqual({ provider: "spacexai", auth: "api_key", connected: true, detail: "ok", subscription: "logged_out" });
  expect(calls[0]).toBe("https://api.x.ai/v1/models");
});

test("without the CLI or a key the provider is not connected", async () => {
  const missing = createSpaceXaiAdapter(deps({ which: () => null }));
  expect(await missing.status()).toEqual({ provider: "spacexai", auth: "subscription", connected: false, detail: "cli_missing", subscription: "cli_missing" });
  const signedOut = createSpaceXaiAdapter(deps({ readModels: async () => SIGNED_OUT }));
  expect(await signedOut.status()).toEqual({ provider: "spacexai", auth: "subscription", connected: false, detail: "logged_out", subscription: "logged_out" });
  expect(await drain(signedOut.stream(request()))).toEqual([{ type: "error", code: "not_connected" }]);
});

test("the CLI status is cached between calls", async () => {
  let reads = 0;
  const adapter = createSpaceXaiAdapter(deps({ readModels: async () => { reads += 1; return SIGNED_IN; } }));
  await adapter.status();
  await adapter.status();
  await adapter.listModels();
  expect(reads).toBe(1);
});

test("a subscription stream sends the transcript in a temp prompt file and removes it", async () => {
  const rec: Recorded[] = [];
  const adapter = createSpaceXaiAdapter(deps({ run: scripted(fixture("grok-text.jsonl"), rec) }));
  const events = await drain(adapter.stream(request()));
  expect(events.map((e) => e.type)).toEqual(["text", "text", "text", "usage", "done"]);
  const row = rec[0];
  if (row === undefined) throw new Error("not run");
  expect(row.prompt).toContain("<system>\nReply briefly.\n</system>");
  expect(row.prompt).toContain("<user_data>ping</user_data>");
  expect(row.prompt).not.toContain("base64");
  expect(dirname(row.argv[row.argv.indexOf("--prompt-file") + 1] ?? "")).toBe(row.cwd);
  expect(existsSync(join(row.cwd, "prompt.txt"))).toBe(false);
  expect(existsSync(row.cwd)).toBe(false);
});

test("a tool call mid-stream stops the CLI and ends with provider_error", async () => {
  const rec: Recorded[] = [];
  const adapter = createSpaceXaiAdapter(deps({ run: scripted(fixture("grok-tool.jsonl"), rec) }));
  const events = await drain(adapter.stream(request()));
  expect(events).toEqual([{ type: "text", delta: "Searching" }, { type: "error", code: "provider_error" }]);
  expect(rec[0]?.stopped).toBe(true);
});

test("a stream that ends without an end event is an error, not done", async () => {
  const rec: Recorded[] = [];
  const adapter = createSpaceXaiAdapter(deps({ run: scripted('{"type":"text","data":"partial"}', rec) }));
  expect(await drain(adapter.stream(request()))).toEqual([{ type: "text", delta: "partial" }, { type: "error", code: "provider_error" }]);
});
