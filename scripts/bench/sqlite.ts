// SQLite commit bench: 1000 single-row INSERT transactions, WAL + FULL vs NORMAL.
// Run: bun scripts/bench/sqlite.ts
import { SQL } from "bun";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";

const N = 1000;
const root = join(import.meta.dir, "../../.cache");
mkdirSync(root, { recursive: true });

// O(N) commits
// INV: the file lives on the workspace disk (.cache/), not tmpfs /tmp, so FULL actually fsyncs
async function timeMode(mode: "FULL" | "NORMAL"): Promise<number> {
  const dir = mkdtempSync(join(root, "sql-bench-"));
  const path = join(dir, "t.sqlite");
  const db = new SQL(`sqlite://${path}`);
  try {
    await db`PRAGMA journal_mode=WAL`;
    await db.unsafe(`PRAGMA synchronous=${mode}`);
    await db`CREATE TABLE t (id INTEGER PRIMARY KEY, n INTEGER NOT NULL)`;
    const t0 = performance.now();
    for (let i = 0; i < N; i++) await db`INSERT INTO t (n) VALUES (${i})`;
    return performance.now() - t0;
  } finally {
    await db.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

const full: number[] = [];
const normal: number[] = [];
for (let k = 0; k < 3; k++) {
  full.push(await timeMode("FULL"));
  normal.push(await timeMode("NORMAL"));
}
full.sort((a, b) => a - b);
normal.sort((a, b) => a - b);
console.log(`WAL FULL  1000 inserts: ${full.map((x) => x.toFixed(0)).join(" ")} ms (median ${full[1]!.toFixed(0)} ms)`);
console.log(`WAL NORMAL 1000 inserts: ${normal.map((x) => x.toFixed(0)).join(" ")} ms (median ${normal[1]!.toFixed(0)} ms)`);
