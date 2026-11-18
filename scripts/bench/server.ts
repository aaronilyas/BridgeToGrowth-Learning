// Server bench: startServer() to first /api/providers response, with the real provider adapters.
// Run: bun scripts/bench/server.ts [warm=0|1] [windowLoadMs=0]   (uses a throwaway BTG_DATA_DIR unless one is set)
// windowLoadMs stands in for the WebView starting and loading the page before it asks for /api/providers
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.BTG_DATA_DIR ??= mkdtempSync(join(tmpdir(), "btg-bench-"));
const [warm = 0, windowLoadMs = 0] = process.argv.slice(2).map(Number);
const t0 = performance.now();
const { startServer } = await import("../../src/server/boot.ts");
const token = "bench-token";
const server = await startServer({ token, warmProviders: warm === 1 });
const tBoot = performance.now();
await Bun.sleep(windowLoadMs);
const tAsk = performance.now();
const res = await fetch(`${server.url}/api/providers`, { headers: { "x-btg-token": token } });
const body = (await res.json()) as Array<{ provider: string; connected?: boolean }>;
const tFirst = performance.now();
const again = await fetch(`${server.url}/api/providers`, { headers: { "x-btg-token": token } });
await again.arrayBuffer();
const tSecond = performance.now();
console.log(`startServer ${(tBoot - t0).toFixed(0)} ms (incl. module load); warm=${warm} windowLoad=${windowLoadMs} ms; first /api/providers answered ${(tFirst - tAsk).toFixed(0)} ms after asking (status ${res.status}); second +${(tSecond - tFirst).toFixed(0)} ms`);
console.log(`providers: ${body.map((p) => `${p.provider}:${p.connected ? "on" : "off"}`).join(" ")}`);
await server.stop();
process.exit(0);
