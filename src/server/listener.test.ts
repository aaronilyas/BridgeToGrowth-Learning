import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BundleAssets } from "./listener.ts";
import { TEST_ENV } from "./testkit.ts";

Object.assign(process.env, TEST_ENV);

const TOKEN = "t".repeat(64);
const CHUNK = "/chunk-listen01.js";
const FONT = "/KaTeX_Main-Regular-test0001.woff2";
const SERVER_CHUNK = "/chunk-server01.js";
const MISSING = "/chunk-missing1.js";
const IMMUTABLE = "public, max-age=31536000, immutable";
const JS = "text/javascript;charset=utf-8";
const dir = mkdtempSync(join(tmpdir(), "btg-listener-"));
const bodies: Record<string, string> = { [CHUNK]: "export const n=1;\n", [FONT]: "woff2-bytes", [SERVER_CHUNK]: "server code" };
for (const [path, body] of Object.entries(bodies)) writeFileSync(join(dir, path.slice(1)), body);
// the bundle manifest lists the web chunk, the font and a file that is gone; never the server chunk beside them
const assets: BundleAssets = new Map([
  [CHUNK, { file: join(dir, CHUNK.slice(1)), headers: { "content-type": JS, etag: "\"c1\"" } }],
  [FONT, { file: join(dir, FONT.slice(1)), headers: { "content-type": "font/woff2", etag: "\"f1\"" } }],
  [MISSING, { file: join(dir, MISSING.slice(1)), headers: { "content-type": JS, etag: "\"m1\"" } }],
]);
afterAll(() => rmSync(dir, { recursive: true, force: true }));

// O(1)
function upstreamLike(req: Request): Response {
  const path = new URL(req.url).pathname;
  const hit = assets.get(path);
  if (hit && bodies[path] !== undefined) return new Response(bodies[path], { headers: hit.headers });
  return new Response("html-fallback", { headers: { "content-type": "text/html;charset=utf-8" } });
}

// O(1) plus the callback
async function withPub(mode: string, fn: (url: URL, hits: () => number) => Promise<void>): Promise<void> {
  const { env } = await import("./env.ts");
  const { servePublic } = await import("./listener.ts");
  const state = env as { NODE_ENV: string };
  const prev = state.NODE_ENV;
  state.NODE_ENV = mode;
  let n = 0;
  const upstream = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: (req) => (n++, upstreamLike(req)) });
  const pub = servePublic({ port: 0, api: {}, upstream: upstream.url, token: TOKEN, assets });
  try {
    await fn(pub.url, () => n);
  } finally {
    state.NODE_ENV = prev;
    pub.stop(true);
    upstream.stop(true);
  }
}

test("production bundle assets are served from disk with the upstream's body and headers plus the immutable header, and HEAD works", async () => {
  const proxied: Record<string, Response> = {};
  await withPub("development", async (base) => {
    for (const path of [CHUNK, FONT]) proxied[path] = await fetch(new URL(path, base));
  });
  await withPub("production", async (base, hits) => {
    for (const path of [CHUNK, FONT]) {
      const direct = await fetch(new URL(path, base));
      const before = proxied[path]!;
      expect(await direct.text()).toBe(await before.text());
      expect(direct.headers.get("content-type")).toBe(before.headers.get("content-type"));
      expect(direct.headers.get("etag")).toBe(before.headers.get("etag"));
      expect(direct.headers.get("cache-control")).toBe(IMMUTABLE);
      expect(direct.headers.get("content-security-policy")).toContain("script-src 'self'");
    }
    const head = await fetch(new URL(CHUNK, base), { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    expect(head.headers.get("cache-control")).toBe(IMMUTABLE);
    expect(head.headers.get("content-type")).toBe(JS);
    expect(hits()).toBe(0);
  });
});

test("a server chunk beside the bundle, a traversal, a nested path or a non-hashed name goes to the upstream", async () => {
  await withPub("production", async (base, hits) => {
    const paths = [SERVER_CHUNK, `${CHUNK}/../x`, `/nested${CHUNK}`, "/not-hashed.js", "/chunk-NOPE.js", `/foo${FONT}`];
    for (const path of paths) {
      const res = await fetch(new URL(path, base));
      expect(await res.text()).toBe("html-fallback");
      expect(res.headers.get("cache-control")).not.toBe(IMMUTABLE);
    }
    expect(hits()).toBe(paths.length);
  });
});

test("a listed hashed file missing from disk falls through to the upstream, not 500", async () => {
  await withPub("production", async (base, hits) => {
    const res = await fetch(new URL(MISSING, base));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("html-fallback");
    expect(hits()).toBe(1);
  });
});

test("dev mode proxies every asset even when a manifest is given", async () => {
  await withPub("development", async (base, hits) => {
    const res = await fetch(new URL(CHUNK, base));
    expect(await res.text()).toBe(bodies[CHUNK]!);
    expect(res.headers.get("cache-control")).not.toBe(IMMUTABLE);
    expect(hits()).toBe(1);
  });
});

test("an HTML document is always revalidated, so a webview never renders a previous version's cached page", async () => {
  for (const mode of ["production", "development"]) {
    await withPub(mode, async (base) => {
      for (const path of ["/", "/practice", MISSING]) {
        const res = await fetch(new URL(path, base));
        expect(res.headers.get("content-type")).toStartWith("text/html");
        expect(res.headers.get("cache-control")).toBe("no-cache");
        expect(await res.text()).toBe("html-fallback");
      }
    });
  }
  await withPub("production", async (base) => {
    expect((await fetch(new URL(CHUNK, base))).headers.get("cache-control")).toBe(IMMUTABLE);
  });
});
