import { beforeAll, expect, test } from "bun:test";
import { parseSseChunk } from "../../shared/sse.ts";
import { bootTestServer, createTestUser, type TestServer } from "../testkit.ts";
import type * as GatewayModule from "./gateway.ts";

// O(1)
// INV: a query suffix loads the gateway implementation past the suite's module replacement
async function loadRealGateway(): Promise<typeof GatewayModule> {
  const specifier = "./gateway.ts?real=1";
  return import(specifier);
}

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

test("refreshPricing leaves an unlisted paid system model unpriced", async () => {
  const { env } = await import("../env.ts");
  const { TEST_ENV } = await import("../testkit.ts");
  const { refreshPricing } = await loadRealGateway();
  const { MODELS, SYSTEM_MODELS, priceOf, setPricing } = await import("./models.ts");
  const paid = "openai/gpt-4o";
  const previousEnv = env.OPENROUTER_MODEL;
  const previousTest = TEST_ENV.OPENROUTER_MODEL ?? "openrouter/free";
  const previousSystems = { grade: SYSTEM_MODELS.grade, extract: SYSTEM_MODELS.extract, insight: SYSTEM_MODELS.insight };
  env.OPENROUTER_MODEL = paid;
  TEST_ENV.OPENROUTER_MODEL = paid;
  SYSTEM_MODELS.grade = paid;
  SYSTEM_MODELS.extract = paid;
  SYSTEM_MODELS.insight = paid;
  setPricing(null);
  const logged: string[] = [];
  const prevError = console.error;
  console.error = (...args: unknown[]) => {
    logged.push(args.map((part) => String(part)).join(" "));
    prevError(...args);
  };
  try {
    const data = MODELS.map((m) => ({ id: m.id, context_length: 128_000, pricing: { prompt: "0.000001", completion: "0.000002" } }));
    const fetchFn: typeof fetch = Object.assign(async () => Response.json({ data }), { preconnect: () => {} });
    expect(await refreshPricing(fetchFn)).toBe(true);
    expect(priceOf(paid)).toEqual({ loaded: true, price: undefined });
    expect(logged).toContain("llm: system model unlisted");
  } finally {
    console.error = prevError;
    env.OPENROUTER_MODEL = previousEnv;
    TEST_ENV.OPENROUTER_MODEL = previousTest;
    SYSTEM_MODELS.grade = previousSystems.grade;
    SYSTEM_MODELS.extract = previousSystems.extract;
    SYSTEM_MODELS.insight = previousSystems.insight;
    setPricing(null);
  }
});

test("the 201st zero-priced call in a day throws rate_limited", async () => {
  const { prepareCall } = await loadRealGateway();
  const { FREE_PRICE, SYSTEM_MODELS, setPricing } = await import("./models.ts");
  const { HttpError } = await import("../http.ts");
  setPricing(new Map([[SYSTEM_MODELS.grade, FREE_PRICE]]));
  const who = { uid: crypto.randomUUID(), plan: "free" as const, capMicros: 1_000_000n };
  const messages = [{ role: "user" as const, content: "grade this" }];
  try {
    for (let i = 0; i < 200; i++) prepareCall(who, { system: "grade" }, "grade", messages, 200);
    let caught: unknown;
    try {
      prepareCall(who, { system: "grade" }, "grade", messages, 200);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(HttpError);
    if (!(caught instanceof HttpError)) throw new Error("missing rate limit");
    expect(caught.status).toBe(429);
    expect(caught.code).toBe("rate_limited");
  } finally {
    setPricing(null);
  }
});
