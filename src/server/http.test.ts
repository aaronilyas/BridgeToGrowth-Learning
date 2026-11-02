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

test("an /api route served by the public listener carries CSP, nosniff and HSTS, and a foreign Origin is still 403", async () => {
  const { env } = await import("./env.ts");
  const { route, json } = await import("./http.ts");
  const { servePublic } = await import("./listener.ts");
  const { seasonRoutes } = await import("./season/routes.ts");
  const mode = env as { NODE_ENV: string };
  const prev = mode.NODE_ENV;
  mode.NODE_ENV = "production";
  let proxied = 0;
  const upstream = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => (proxied++, new Response("doc", { headers: { "content-type": "text/html" } })) });
  const api = { ...seasonRoutes, "/api/echo": { POST: route({ body: z.strictObject({ a: z.string() }) }, async (c) => json(c.body)) } };
  const pub = servePublic({ port: 0, api, upstream: upstream.url });
  try {
    const got = await fetch(new URL("/api/season", pub.url));
    expect(got.status).toBe(200);
    const evil = await fetch(new URL("/api/echo", pub.url), { method: "POST", headers: { origin: "https://evil.test", "content-type": "application/json" }, body: '{"a":"1"}' });
    for (const res of [got, evil]) {
      expect(res.headers.get("content-security-policy")).toContain("script-src 'self'");
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      expect(res.headers.get("strict-transport-security")).toBe("max-age=15552000; includeSubDomains");
    }
    expect(evil.status).toBe(403);
    expect(await evil.json()).toEqual({ error: "forbidden_origin" });
    const ok = await fetch(new URL("/api/echo", pub.url), { method: "POST", headers: { origin: "https://app.test", "content-type": "application/json" }, body: '{"a":"1"}' });
    expect(await ok.json()).toEqual({ a: "1" });
    expect(proxied).toBe(0);
    const doc = await fetch(new URL("/teach", pub.url));
    expect(await doc.text()).toBe("doc");
    expect(doc.headers.get("strict-transport-security")).not.toBeNull();
    expect(proxied).toBe(1);
  } finally {
    mode.NODE_ENV = prev;
    pub.stop(true);
    upstream.stop(true);
  }
});

test("a hashed font file is cached as immutable, but the HTML fallback for the same path is not", async () => {
  const { env } = await import("./env.ts");
  const { servePublic } = await import("./listener.ts");
  const mode = env as { NODE_ENV: string };
  const prev = mode.NODE_ENV;
  mode.NODE_ENV = "production";
  let type = "font/woff2";
  const upstream = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("x", { headers: { "content-type": type } }) });
  const pub = servePublic({ port: 0, api: {}, upstream: upstream.url });
  const path = "/KaTeX_Main-Regular-xvp1b75c.woff2";
  try {
    const font = await fetch(new URL(path, pub.url));
    expect(font.status).toBe(200);
    expect(font.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    type = "text/html;charset=utf-8";
    const fallback = await fetch(new URL(path, pub.url));
    expect(fallback.status).toBe(200);
    expect(fallback.headers.get("cache-control")).not.toBe("public, max-age=31536000, immutable");
  } finally {
    mode.NODE_ENV = prev;
    pub.stop(true);
    upstream.stop(true);
  }
});
