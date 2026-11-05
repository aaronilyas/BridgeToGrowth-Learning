import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { BUN_MAX_IDLE_S, JSON_TIMEOUT_MS, SERVER_IDLE_TIMEOUT_S, STREAM_TIMEOUT_MS } from "./timeouts.ts";

const PAST_DEFAULT_IDLE_MS = 15_000;
// A Grok subscription lesson plan measured 105s at high reasoning effort.
const OBSERVED_SLOW_PLAN_MS = 105_000;

test("a slow subscription-model answer fits the JSON budget, and every budget fits the server's idle window", () => {
  expect(JSON_TIMEOUT_MS).toBeGreaterThan(OBSERVED_SLOW_PLAN_MS);
  expect(SERVER_IDLE_TIMEOUT_S).toBeLessThanOrEqual(BUN_MAX_IDLE_S);
  expect(SERVER_IDLE_TIMEOUT_S * 1000).toBeGreaterThan(Math.max(JSON_TIMEOUT_MS, STREAM_TIMEOUT_MS));
});

test("the server keeps a quiet model call open past Bun's 10s idle timeout", async () => {
  const listener = readFileSync(new URL("../listener.ts", import.meta.url), "utf8");
  expect(listener).toContain("idleTimeout: SERVER_IDLE_TIMEOUT_S");
  expect(SERVER_IDLE_TIMEOUT_S).toBeGreaterThanOrEqual(150);

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    idleTimeout: SERVER_IDLE_TIMEOUT_S,
    routes: {
      "/slow": {
        GET: async () => {
          await Bun.sleep(PAST_DEFAULT_IDLE_MS);
          return Response.json({ ok: true });
        },
      },
    },
  });
  try {
    const res = await fetch(`${server.url}slow`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  } finally {
    server.stop(true);
  }
}, { timeout: 30_000 });
