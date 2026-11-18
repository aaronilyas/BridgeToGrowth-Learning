import { expect, test } from "bun:test";
import { unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { TEST_ENV } from "./testkit.ts";

Object.assign(process.env, TEST_ENV);

const TOKEN = "t".repeat(64);
const CHUNK = "chunk-listentest1.js";
const FONT = "KaTeX_Main-Regular-test0001.woff2";
const IMMUTABLE = "public, max-age=31536000, immutable";

// O(1)
function writeBeside(name: string, body: string): () => void {
  const path = join(import.meta.dir, name);
  writeFileSync(path, body);
  return () => { try { unlinkSync(path); } catch { /* already gone */ } };
}

// O(1) plus the callback
async function withPub(mode: string, upstreamBody: (req: Request) => Response, fn: (url: URL, hits: () => number) => Promise<void>): Promise<void> {
  const { env } = await import("./env.ts");
  const { servePublic } = await import("./listener.ts");
  const state = env as { NODE_ENV: string };
  const prev = state.NODE_ENV;
  state.NODE_ENV = mode;
  let n = 0;
  const upstream = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: (req) => (n++, upstreamBody(req)) });
  const pub = servePublic({ port: 0, api: {}, upstream: upstream.url, token: TOKEN });
  try {
    await fn(pub.url, () => n);
  } finally {
    state.NODE_ENV = prev;
    pub.stop(true);
    upstream.stop(true);
  }
}

test("production hashed assets match the proxied body, content-type, and cache-control, and HEAD works", async () => {
  const chunkBody = "export const n=1;\n";
  const fontBody = "woff2-bytes";
  const typeOf = (req: Request): string => new URL(req.url).pathname.endsWith(".js") ? "text/javascript;charset=utf-8" : "font/woff2";
  const bodyOf = (req: Request): string => new URL(req.url).pathname.endsWith(".js") ? chunkBody : fontBody;
  await withPub("production", (req) => new Response(bodyOf(req), { headers: { "content-type": typeOf(req) } }), async (base, hits) => {
    const chunkUrl = new URL(`/${CHUNK}`, base);
    const fontUrl = new URL(`/${FONT}`, base);
    const proxiedChunk = await fetch(chunkUrl);
    const proxiedFont = await fetch(fontUrl);
    expect(hits()).toBe(2);
    const dropChunk = writeBeside(CHUNK, chunkBody);
    const dropFont = writeBeside(FONT, fontBody);
    try {
      const directChunk = await fetch(chunkUrl);
      const directFont = await fetch(fontUrl);
      const head = await fetch(chunkUrl, { method: "HEAD" });
      expect(hits()).toBe(2);
      expect(await directChunk.text()).toBe(await proxiedChunk.text());
      expect(await directFont.text()).toBe(await proxiedFont.text());
      expect(directChunk.headers.get("content-type")).toBe(proxiedChunk.headers.get("content-type"));
      expect(directFont.headers.get("content-type")).toBe(proxiedFont.headers.get("content-type"));
      expect(directChunk.headers.get("cache-control")).toBe(IMMUTABLE);
      expect(directFont.headers.get("cache-control")).toBe(IMMUTABLE);
      expect(proxiedChunk.headers.get("cache-control")).toBe(IMMUTABLE);
      expect(directChunk.headers.get("content-security-policy")).toContain("script-src 'self'");
      expect(head.status).toBe(200);
      expect(await head.text()).toBe("");
      expect(head.headers.get("cache-control")).toBe(IMMUTABLE);
      expect(head.headers.get("content-type")).toBe(directChunk.headers.get("content-type"));
    } finally {
      dropChunk();
      dropFont();
    }
  });
});

test("a traversal, nested path, or non-hashed name goes to the upstream", async () => {
  await withPub("production", () => new Response("up", { headers: { "content-type": "text/html" } }), async (base, hits) => {
    const drop = writeBeside(CHUNK, "disk");
    try {
      for (const path of ["/" + CHUNK + "/../secret", "/nested/" + CHUNK, "/not-hashed.js", "/chunk-NOPE.js", "/foo/" + FONT]) {
        const res = await fetch(new URL(path, base));
        expect(await res.text()).toBe("up");
        expect(res.headers.get("cache-control")).not.toBe(IMMUTABLE);
      }
      expect(hits()).toBeGreaterThan(0);
    } finally {
      drop();
    }
  });
});

test("a missing hashed file falls through to the upstream, not 500", async () => {
  await withPub("production", () => new Response("html-fallback", { headers: { "content-type": "text/html;charset=utf-8" } }), async (base, hits) => {
    const res = await fetch(new URL("/chunk-missinghash1.js", base));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("html-fallback");
    expect(res.headers.get("cache-control")).not.toBe(IMMUTABLE);
    expect(hits()).toBe(1);
  });
});

test("dev mode still proxies hashed assets even when the file is on disk", async () => {
  const drop = writeBeside(CHUNK, "from-disk");
  try {
    await withPub("development", () => new Response("from-upstream", { headers: { "content-type": "text/javascript;charset=utf-8" } }), async (base, hits) => {
      const res = await fetch(new URL(`/${CHUNK}`, base));
      expect(await res.text()).toBe("from-upstream");
      expect(hits()).toBe(1);
      expect(res.headers.get("cache-control")).not.toBe(IMMUTABLE);
    });
  } finally {
    drop();
  }
});
