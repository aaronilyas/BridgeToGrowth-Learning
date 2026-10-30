import { beforeAll, expect, test } from "bun:test";
import { parseSseChunk } from "../../shared/sse.ts";
import { bootTestServer, createTestUser, type TestServer } from "../testkit.ts";

let t: TestServer;
let core: typeof import("./core.ts");
let reserveQuota: typeof import("./sql.ts")["reserveQuota"];

beforeAll(async () => {
  t = await bootTestServer();
  core = await import("./core.ts");
  reserveQuota = (await import("./sql.ts")).reserveQuota;
});

test("20 concurrent reservations against a cap for 5 admit exactly 5", async () => {
  await t.reset();
  const u = await createTestUser();
  const period = core.periodOf(new Date());
  const est = 1_000n;
  const results = await Promise.all(Array.from({ length: 20 }, () => reserveQuota(u.id, period, est, 5n * est)));
  expect(results.filter(Boolean)).toHaveLength(5);
  const [row] = await t.sql`SELECT reserved_micros::text AS r FROM usage_periods WHERE user_id = ${u.id}`;
  expect(BigInt(row.r)).toBe(5n * est);
});

test("parseSseChunk handles split frames, comments and [DONE]", () => {
  const stream = [
    ": OPENROUTER PROCESSING\n\n",
    'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\nda',
    'ta: {"choices":[{"delta":{"con',
    'tent":"lo"}}]}\n',
    "\n: OPENROUTER PROCESSING\n\ndata: ",
    '{"choices":[{"delta":{}}],"usage":{"cost":0.0012,"prompt_tokens":9,"completion_tokens":2}}\n\n',
    "data: [DONE]\n\n",
  ];
  let rest = "";
  const events: unknown[] = [];
  for (const piece of stream) {
    const r = parseSseChunk(rest + piece);
    rest = r.rest;
    events.push(...r.events);
  }
  expect(rest).toBe("");
  const deltas = events.map((e) => core.readDelta(e)).filter((d) => d.text).map((d) => d.text);
  expect(deltas).toEqual(["Hel", "lo"]);
  expect(events).toHaveLength(3);
  expect(events[2]).toEqual({ choices: [{ delta: {} }], usage: { cost: 0.0012, prompt_tokens: 9, completion_tokens: 2 } });
});

test("assertModelAllowed accepts only the selectable models", async () => {
  const { MODELS } = await import("./models.ts");
  expect(MODELS.map((m) => m.id)).toEqual(["deepseek/deepseek-v4.1-flash", "z-ai/glm-5.3-flash", "openai/gpt-6-luna"]);
  for (const m of MODELS) expect(() => core.assertModelAllowed(m.id)).not.toThrow();
  expect(() => core.assertModelAllowed("openrouter/free")).toThrow("model_not_allowed");
  expect(() => core.assertModelAllowed("evil/unknown-model")).toThrow("model_not_allowed");
  expect(core.reasoningPayload("low")).toEqual({ reasoning: { effort: "low" } });
  expect(core.reasoningPayload("high")).toEqual({ reasoning: { effort: "high" } });
  expect(core.reasoningPayload("max")).toEqual({ reasoning: { effort: "max" } });
});
