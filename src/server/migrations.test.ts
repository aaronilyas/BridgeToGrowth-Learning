import { SQL } from "bun";
import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrateDatabase } from "../../scripts/migrate.ts";

// O(1)
async function countMigrationLedger(path: string): Promise<number> {
  const db = new SQL(`sqlite://${path}`);
  try {
    const rows = await db`SELECT count(*) AS n FROM schema_migrations LIMIT 1` as { n: number }[];
    return rows[0]?.n ?? 0;
  } finally {
    await db.close();
  }
}

test("migrations apply once and reject a changed checksum", async () => {
  const path = join(mkdtempSync(join(tmpdir(), "btg-mig-")), "btg.sqlite");
  await migrateDatabase(path);
  const first = await countMigrationLedger(path);
  expect(first).toBeGreaterThan(0);
  await migrateDatabase(path);
  expect(await countMigrationLedger(path)).toBe(first);
  const db = new SQL(`sqlite://${path}`);
  await db`UPDATE schema_migrations SET sha256 = '0' WHERE name = '0001_init.sql'`;
  await db.close();
  await expect(migrateDatabase(path)).rejects.toThrow("checksum mismatch: 0001_init.sql");
});
