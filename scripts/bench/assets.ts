// Hashed-asset GET bench. Run: bun scripts/bench/assets.ts
// INV: builds nothing; times proxied vs on-disk GETs through two servePublic listeners in production, the second given a bundle manifest
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.NODE_ENV = "production";
const { servePublic } = await import("../../src/server/listener.ts");

const N = 200;
const chunkName = "chunk-benchasset1.js";
const fontName = "KaTeX_Main-Regular-bench001.woff2";
const chunkBody = "x".repeat(80 * 1024);
const fontBody = "y".repeat(20 * 1024);
const dir = mkdtempSync(join(tmpdir(), "btg-assets-"));
const JS = "text/javascript;charset=utf-8";
writeFileSync(join(dir, chunkName), chunkBody);
writeFileSync(join(dir, fontName), fontBody);
const assets = new Map([[`/${chunkName}`, { file: join(dir, chunkName), headers: { "content-type": JS } }], [`/${fontName}`, { file: join(dir, fontName), headers: { "content-type": "font/woff2" } }]]);

// O(n log n)
function pct(xs: number[], p: number): string {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))]!.toFixed(3);
}

// O(N) plus transfer
async function timeGets(url: URL): Promise<number[]> {
  const times: number[] = [];
  for (let i = 0; i < N; i++) {
    const t0 = performance.now();
    const res = await fetch(url);
    await res.arrayBuffer();
    times.push(performance.now() - t0);
  }
  return times;
}

const upstream = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(req) {
    const js = new URL(req.url).pathname.endsWith(".js");
    return new Response(js ? chunkBody : fontBody, { headers: { "content-type": js ? "text/javascript;charset=utf-8" : "font/woff2" } });
  },
});
const proxy = servePublic({ port: 0, api: {}, upstream: upstream.url, token: "t".repeat(64) });
const disk = servePublic({ port: 0, api: {}, upstream: upstream.url, token: "t".repeat(64), assets });
const at = (server: { url: URL }, name: string): URL => new URL(`/${name}`, server.url);
try {
  for (const server of [proxy, disk]) for (const name of [chunkName, fontName]) await (await fetch(at(server, name))).arrayBuffer();
  const proxyChunk = await timeGets(at(proxy, chunkName));
  const proxyFont = await timeGets(at(proxy, fontName));
  const diskChunk = await timeGets(at(disk, chunkName));
  const diskFont = await timeGets(at(disk, fontName));
  for (const [label, times] of [["proxy chunk", proxyChunk], ["proxy font", proxyFont], ["disk chunk", diskChunk], ["disk font", diskFont]] as const) {
    console.log(`${label} n=${N} median=${pct(times, 0.5)} ms p95=${pct(times, 0.95)} ms`);
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
  proxy.stop(true);
  disk.stop(true);
  upstream.stop(true);
}
