import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createCodexAdapter, type CodexDeps } from "./codex.ts";
import { collectCodexEvents } from "./codexParse.ts";
import type { LlmEvent, LlmRequest, ModelRef } from "./types.ts";

function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
}

const model: ModelRef = { provider: "codex", id: "gpt-6-luna", label: "Luna", vision: true, structured: "native", reasoning: ["low", "high"], contextTokens: 272000 };

function request(): LlmRequest {
  return { model, system: "Reply briefly.", messages: [{ role: "user", text: "ping" }], reasoning: "low", maxOutputTokens: 32, signal: AbortSignal.timeout(1000) };
}

async function collect(deps: CodexDeps): Promise<LlmEvent[]> {
  const events: LlmEvent[] = [];
  for await (const event of createCodexAdapter(deps).stream(request())) events.push(event);
  return events;
}

test("the recorded structured fixture maps the message and usage", () => {
  const parsed = collectCodexEvents(fixture("codex-structured.jsonl"));
  expect(parsed.aborted).toBe(false);
  expect(parsed.events).toEqual([
    { type: "text", delta: "{\"answer\":\"two plus two is four\"}" },
    { type: "usage", inputTokens: 13512, outputTokens: 19, costUsd: null },
  ]);
});

test("multiple messages stay in order and usage is mapped", () => {
  const parsed = collectCodexEvents(fixture("codex-multi.jsonl"));
  expect(parsed.aborted).toBe(false);
  expect(parsed.events.map((event) => event.type === "text" ? event.delta : event.type)).toEqual(["one", "two", "usage"]);
  expect(parsed.events[2]).toEqual({ type: "usage", inputTokens: 3, outputTokens: 4, costUsd: null });
});

test("a command_execution item aborts with provider_error", async () => {
  const parsed = collectCodexEvents(fixture("codex-command.jsonl"));
  expect(parsed.aborted).toBe(true);
  expect(parsed.events).toEqual([{ type: "error", code: "provider_error" }]);
  let stopped = false;
  const events = await collect({
    which: () => "/usr/bin/codex",
    statusCode: async () => 0,
    run: () => ({ lines: (async function* () { yield fixture("codex-command.jsonl").trim(); })(), stop: () => { stopped = true; } }),
  });
  expect(events).toEqual([{ type: "error", code: "provider_error" }]);
  expect(stopped).toBe(true);
});

test("turn.failed becomes an error event", () => {
  const parsed = collectCodexEvents(fixture("codex-failed.jsonl"));
  expect(parsed.aborted).toBe(false);
  expect(parsed.events).toEqual([{ type: "error", code: "provider_error" }]);
});

test("a logged-out status maps to not_connected", async () => {
  let ran = false;
  const events = await collect({
    which: () => "/usr/bin/codex",
    statusCode: async () => 1,
    run: () => {
      ran = true;
      return { lines: (async function* () {})(), stop: () => undefined };
    },
  });
  expect(ran).toBe(false);
  expect(events).toEqual([{ type: "error", code: "not_connected" }]);
});
