import { SQL } from "bun";
import { chmodSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { databasePath } from "../src/server/paths.ts";

import m0001 from "../db/migrations/0001_init.sql" with { type: "text" };
import m0002 from "../db/migrations/0002_provider_models.sql" with { type: "text" };
import m0003 from "../db/migrations/0003_llm_usage.sql" with { type: "text" };
import m0004 from "../db/migrations/0004_drop_legacy.sql" with { type: "text" };
import m0005 from "../db/migrations/0005_chat_steps.sql" with { type: "text" };
import m0007 from "../db/migrations/0007_lesson_turns.sql" with { type: "text" };
import m0008 from "../db/migrations/0008_restore_v011_tables.sql" with { type: "text" };
import syncLegacyLessons from "../db/sync_legacy_lessons.sql" with { type: "text" };

// INV: embedded so a packaged app needs no db/ directory; migrations.test.ts checks this list equals db/migrations/*.sql in order
// INV: the third element names a ledger row the migration requires; without that row it is skipped and not recorded
// INV: 0006_lesson_topics.sql is retired and its name must not be reused. It rewrote tables v0.1.1 reads, so databases that ran it are found by that ledger row and repaired by 0008. db/retired keeps the file for the repair test.
export const MIGRATIONS: ReadonlyArray<readonly [name: string, source: string, requires?: string]> = [
  ["0001_init.sql", m0001],
  ["0002_provider_models.sql", m0002],
  ["0003_llm_usage.sql", m0003],
  ["0004_drop_legacy.sql", m0004],
  ["0005_chat_steps.sql", m0005],
  ["0007_lesson_turns.sql", m0007],
  ["0008_restore_v011_tables.sql", m0008, "0006_lesson_topics.sql"],
];

// O(1)
export async function configureSqlite(db: SQL): Promise<void> {
  await db`PRAGMA journal_mode=WAL`;
  await db`PRAGMA foreign_keys=ON`;
  await db`PRAGMA busy_timeout=5000`;
}

// O(F + total migration size)
// INV: an applied migration whose SHA-256 changes aborts without applying later files
// INV: the legacy import runs on every call, so lessons changed under v0.1.1 are picked up on each upgrade
export async function runMigrations(db: SQL): Promise<void> {
  await configureSqlite(db);
  await db`CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, sha256 TEXT NOT NULL, applied_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000))`;
  const rows = await db`SELECT name, sha256 FROM schema_migrations LIMIT 100000` as { name: string; sha256: string }[];
  const applied = new Map(rows.map((row) => [row.name, row.sha256]));
  for (const [name, source, requires] of MIGRATIONS) {
    if (requires !== undefined && !applied.has(requires)) continue;
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
  await db.begin(async (tx) => {
    await tx.unsafe(syncLegacyLessons);
  });
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

// INV: no top-level await, so bundling the server (which imports this module) stays synchronous
if (import.meta.main) {
  migrateDatabase(process.argv[2]).catch((error: unknown) => {
    console.error(`migration failed: ${error instanceof Error ? error.message : "unknown"}`);
    process.exitCode = 1;
  });
}
