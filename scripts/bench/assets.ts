// Hashed-asset GET bench. Run: bun scripts/bench/assets.ts
// INV: builds nothing; times proxy vs on-disk GETs through servePublic in production
import { unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

process.env.NODE_ENV = "production";
const { servePublic } = await import("../../src/server/listener.ts");

const N = 200;
const chunkName = "chunk-benchasset1.js";
const fontName = "KaTeX_Main-Regular-bench001.woff2";
const chunkBody = "x".repeat(80 * 1024);
const fontBody = "y".repeat(20 * 1024);
const dir = join(import.meta.dir, "../../src/server");

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
const pub = servePublic({ port: 0, api: {}, upstream: upstream.url, token: "t".repeat(64) });
const chunkUrl = new URL(`/${chunkName}`, pub.url);
const fontUrl = new URL(`/${fontName}`, pub.url);
try {
  for (const url of [chunkUrl, fontUrl]) await (await fetch(url)).arrayBuffer();
  const proxyChunk = await timeGets(chunkUrl);
  const proxyFont = await timeGets(fontUrl);
  writeFileSync(join(dir, chunkName), chunkBody);
  writeFileSync(join(dir, fontName), fontBody);
  try {
    const diskChunk = await timeGets(chunkUrl);
    const diskFont = await timeGets(fontUrl);
    for (const [label, times] of [["proxy chunk", proxyChunk], ["proxy font", proxyFont], ["disk chunk", diskChunk], ["disk font", diskFont]] as const) {
      console.log(`${label} n=${N} median=${pct(times, 0.5)} ms p95=${pct(times, 0.95)} ms`);
    }
  } finally {
    unlinkSync(join(dir, chunkName));
    unlinkSync(join(dir, fontName));
  }
} finally {
  pub.stop(true);
  upstream.stop(true);
}
