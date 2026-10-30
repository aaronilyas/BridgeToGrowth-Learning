import { SQL } from "bun";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

const dir = join(import.meta.dir, "..", "db", "migrations");

// O(F + total file size)
// INV: an applied file whose sha256 changed aborts with exit 1
async function runMigrations(url: string): Promise<number> {
  const db = new SQL({ url, max: 1 });
  try {
    await db`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, sha256 text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`;
    const rows = await db`SELECT name, sha256 FROM schema_migrations LIMIT 100000`;
    const applied = new Map<string, string>(rows.map((r: { name: string; sha256: string }) => [r.name, r.sha256]));
    const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
    for (const name of files) {
      const text = await Bun.file(join(dir, name)).text();
      const hash = new Bun.CryptoHasher("sha256").update(text).digest("hex");
      const prev = applied.get(name);
      if (prev !== undefined) {
        if (prev !== hash) {
          console.error(`checksum mismatch: ${name}`);
          return 1;
        }
        continue;
      }
      await db.begin(async (tx) => {
        await tx.unsafe(text);
        await tx`INSERT INTO schema_migrations (name, sha256) VALUES (${name}, ${hash})`;
      });
      console.log(`applied ${name}`);
    }
    return 0;
  } catch (e) {
    console.error(`migration failed: ${e instanceof Error ? e.message : "unknown"}`);
    return 1;
  } finally {
    await db.close();
  }
}

async function resolveUrl(): Promise<string> {
  const arg = process.argv[2];
  if (arg) return arg;
  return (await import("../src/server/env.ts")).env.DATABASE_URL;
}

process.exit(await runMigrations(await resolveUrl()));
