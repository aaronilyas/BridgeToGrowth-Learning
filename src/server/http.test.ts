import { expect, test } from "bun:test";
import { z } from "zod";
import { TEST_ENV } from "./testkit.ts";

Object.assign(process.env, TEST_ENV, { DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgres://x" });

test("route rejects foreign origin and unknown body keys", async () => {
  const { route, json, originAllowed } = await import("./http.ts");
  const h = route({ body: z.strictObject({ a: z.string() }) }, async (c) => json({ a: c.body.a }));
  const post = (origin: string, body: unknown) =>
    h(new Request("http://127.0.0.1/x", { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) }));
  const evil = await post("https://evil.test", { a: "1" });
  expect(evil.status).toBe(403);
  expect(await evil.json()).toEqual({ error: "forbidden_origin" });
  expect((await post("http://localhost:3000", { a: "1" })).status).toBe(403);
  expect((await post("https://app.test", { a: "1", b: 2 })).status).toBe(400);
  expect(originAllowed("http://localhost:3000", "http://127.0.0.1:3000")).toBe(true);
  expect(originAllowed("http://127.0.0.1:3000", "http://localhost:3000")).toBe(true);
  expect(originAllowed("http://[::1]:3000", "http://127.0.0.1:3000")).toBe(true);
  expect(originAllowed("http://localhost:3001", "http://127.0.0.1:3000")).toBe(false);
  expect(originAllowed("https://localhost:3000", "http://127.0.0.1:3000")).toBe(false);
  expect(originAllowed("http://localhost:3000", "https://app.test")).toBe(false);
  expect(originAllowed(null, "http://127.0.0.1:3000")).toBe(false);
  expect(originAllowed("null", "http://127.0.0.1:3000")).toBe(false);
});

test("route caps chunked JSON bodies and accepts the exact cap", async () => {
  const { route, json } = await import("./http.ts");
  const cap = 9;
  const h = route({ body: z.strictObject({ a: z.string() }), maxBody: cap }, async (c) => json(c.body));
  const req = (body: string) => new Request("http://127.0.0.1/x", {
    method: "POST",
    headers: { origin: "https://app.test", "content-type": "application/json", "transfer-encoding": "chunked" },
    body,
  });
  expect((await h(req('{"a":"1"} '))).status).toBe(413);
  expect((await h(req('{"a":"1"}'))).status).toBe(200);
});
