import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { SERVER_IDLE_TIMEOUT_S } from "./timeouts.ts";

const PAST_DEFAULT_IDLE_MS = 15_000;

test("the server keeps a quiet model call open past Bun's 10s idle timeout", async () => {
  const index = readFileSync(new URL("../index.ts", import.meta.url), "utf8");
  expect(index).toContain("idleTimeout: SERVER_IDLE_TIMEOUT_S");
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
