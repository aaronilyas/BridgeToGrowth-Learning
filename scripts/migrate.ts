import { SQL } from "bun";
import { chmodSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { databasePath } from "../src/server/paths.ts";

import m0001 from "../db/migrations/0001_init.sql" with { type: "text" };
import m0002 from "../db/migrations/0002_provider_models.sql" with { type: "text" };
import m0003 from "../db/migrations/0003_llm_usage.sql" with { type: "text" };
import m0004 from "../db/migrations/0004_drop_legacy.sql" with { type: "text" };

// INV: embedded so a packaged app needs no db/ directory; migrations.test.ts checks this list equals db/migrations/*.sql in order
export const MIGRATIONS: ReadonlyArray<readonly [string, string]> = [
  ["0001_init.sql", m0001],
  ["0002_provider_models.sql", m0002],
  ["0003_llm_usage.sql", m0003],
  ["0004_drop_legacy.sql", m0004],
];

// O(1)
export async function configureSqlite(db: SQL): Promise<void> {
  await db`PRAGMA journal_mode=WAL`;
  await db`PRAGMA foreign_keys=ON`;
  await db`PRAGMA busy_timeout=5000`;
}

// O(F + total migration size)
// INV: an applied migration whose SHA-256 changes aborts without applying later files
export async function runMigrations(db: SQL): Promise<void> {
  await configureSqlite(db);
  await db`CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, sha256 TEXT NOT NULL, applied_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000))`;
  const rows = await db`SELECT name, sha256 FROM schema_migrations LIMIT 100000` as { name: string; sha256: string }[];
  const applied = new Map(rows.map((row) => [row.name, row.sha256]));
  for (const [name, source] of MIGRATIONS) {
    const digest = new Bun.CryptoHasher("sha256").update(source).digest("hex");
    const previous = applied.get(name);
    if (previous !== undefined) {
      if (previous !== digest) throw new Error(`checksum mismatch: ${name}`);
      continue;
    }
    await db.begin(async (tx) => {
      await tx.unsafe(source);
      await tx`INSERT INTO schema_migrations (name, sha256) VALUES (${name}, ${digest})`;
    });
  }
}

// O(F + total migration size)
export async function migrateDatabase(path: string = databasePath()): Promise<void> {
  const parent = dirname(path);
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  if (parent !== "." && parent !== "") chmodSync(parent, 0o700);
  const db = new SQL(`sqlite://${path}`);
  try {
    await runMigrations(db);
  } finally {
    await db.close();
  }
}

if (import.meta.main) {
  try {
    await migrateDatabase(process.argv[2]);
  } catch (error) {
    console.error(`migration failed: ${error instanceof Error ? error.message : "unknown"}`);
    process.exitCode = 1;
  }
}
