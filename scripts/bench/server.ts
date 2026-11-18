// Server bench: startServer() to first /api/providers response, with the real provider adapters.
// Run: bun scripts/bench/server.ts   (uses a throwaway BTG_DATA_DIR unless one is set)
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.BTG_DATA_DIR ??= mkdtempSync(join(tmpdir(), "btg-bench-"));
const t0 = performance.now();
const { startServer } = await import("../../src/server/boot.ts");
const token = "bench-token";
const server = await startServer({ token });
const tBoot = performance.now();
const res = await fetch(`${server.url}/api/providers`, { headers: { "x-btg-token": token } });
const body = (await res.json()) as Array<{ provider: string; connected?: boolean }>;
const tFirst = performance.now();
const again = await fetch(`${server.url}/api/providers`, { headers: { "x-btg-token": token } });
await again.arrayBuffer();
const tSecond = performance.now();
console.log(`startServer ${(tBoot - t0).toFixed(0)} ms (incl. module load); first /api/providers +${(tFirst - tBoot).toFixed(0)} ms (status ${res.status}); second +${(tSecond - tFirst).toFixed(0)} ms`);
console.log(`providers: ${body.map((p) => `${p.provider}:${p.connected ? "on" : "off"}`).join(" ")}`);
await server.stop();
process.exit(0);
