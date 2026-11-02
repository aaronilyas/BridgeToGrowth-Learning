import { expect, test } from "bun:test";
import { storeProviderKey, useSecretBox } from "../../secrets.ts";
import { providerHttpDetail, readOpenAiSse } from "./openaiSse.ts";
import { createOpenRouterAdapter } from "./openrouter.ts";
import type { LlmEvent, LlmRequest, ModelRef } from "./types.ts";

const box = new Map<string, string>();
useSecretBox({
  get: async ({ name }) => box.get(name) ?? null,
  set: async ({ name, value }) => { box.set(name, value); },
  delete: async ({ name }) => box.delete(name),
});

const model: ModelRef = { provider: "openrouter", id: "unit", label: "Unit", vision: false, structured: "native", reasoning: ["low", "high", "max"], contextTokens: 1000 };

function request(): LlmRequest {
  return { model, system: "Reply with JSON.", messages: [{ role: "user", text: "ping" }], reasoning: "high", maxOutputTokens: 32, signal: AbortSignal.timeout(1000) };
}

function sseBody(frames: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const frame of frames) controller.enqueue(enc.encode(frame));
      controller.close();
    },
  });
}

function mockFetch(status: number, body: BodyInit | null, seen: { text: string }): typeof fetch {
  const fn = async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    seen.text = typeof init?.body === "string" ? init.body : "";
    return new Response(body, { status });
  };
  return Object.assign(fn, { preconnect: () => undefined });
}

async function drain(status: number, body: BodyInit | null): Promise<{ events: LlmEvent[]; body: string }> {
  const seen = { text: "" };
  const events: LlmEvent[] = [];
  for await (const event of createOpenRouterAdapter(mockFetch(status, body, seen)).stream(request())) events.push(event);
  return { events, body: seen.text };
}

test("SSE frames become text, usage, and done", async () => {
  const events: LlmEvent[] = [];
  const body = sseBody([
    'data: {"choices":[{"delta":{"content":"hi"}}]}\n\n',
    'data: {"choices":[{"delta":{"content":" there"}}],"usage":{"prompt_tokens":2,"completion_tokens":3,"cost":0.01}}\n\n',
    "data: [DONE]\n\n",
  ]);
  for await (const event of readOpenAiSse(body)) events.push(event);
  expect(events).toEqual([
    { type: "text", delta: "hi" },
    { type: "text", delta: " there" },
    { type: "usage", inputTokens: 2, outputTokens: 3, costUsd: 0.01 },
    { type: "done" },
  ]);
});

test("401 is key_invalid and auth_expired, and the body has no tools", async () => {
  await storeProviderKey("openrouter", "sk-test-openrouter-key");
  expect(providerHttpDetail(401)).toBe("key_invalid");
  const result = await drain(401, "nope");
  expect(result.events).toEqual([{ type: "error", code: "auth_expired" }]);
  const parsed: unknown = JSON.parse(result.body);
  expect(parsed).not.toHaveProperty("tools");
  expect(parsed).not.toHaveProperty("tool_choice");
  expect(parsed).not.toHaveProperty("functions");
});

test("429 is rate_limited", async () => {
  const result = await drain(429, "slow");
  expect(result.events).toEqual([{ type: "error", code: "rate_limited" }]);
});
