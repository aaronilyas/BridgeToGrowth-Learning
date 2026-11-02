import { SQL } from "bun";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { databasePath } from "../src/server/paths.ts";

const dir = join(import.meta.dir, "..", "db", "migrations");

// O(F + total migration size)
// INV: an applied migration whose SHA-256 changes aborts without applying later files
export async function runMigrations(db: SQL): Promise<void> {
  await db`CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, sha256 TEXT NOT NULL, applied_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000))`;
  const rows = await db`SELECT name, sha256 FROM schema_migrations LIMIT 100000` as { name: string; sha256: string }[];
  const applied = new Map(rows.map((row) => [row.name, row.sha256]));
  for (const name of (await readdir(dir)).filter((file) => file.endsWith(".sql")).sort()) {
    const source = await Bun.file(join(dir, name)).text();
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
  const db = new SQL(`sqlite://${path}`);
  try {
    await db`PRAGMA foreign_keys=ON`;
    await runMigrations(db);
  } finally {
    await db.close();
  }
}

if (import.meta.main) {
  try {
    await migrateDatabase();
  } catch (error) {
    console.error(`migration failed: ${error instanceof Error ? error.message : "unknown"}`);
    process.exitCode = 1;
  }
}
