import { zipSync } from "fflate";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "../db.ts";

// O(n) in the database size
// SEC: the snapshot is the SQLite file only; keychain entries are not in the database and are not added here
export async function exportDatabaseZip(): Promise<Uint8Array> {
  const dir = mkdtempSync(join(tmpdir(), "btg-export-"));
  const snap = join(dir, "learning.sqlite");
  try {
    await sql`VACUUM INTO ${snap}`;
    const bytes = new Uint8Array(await Bun.file(snap).arrayBuffer());
    return zipSync({ "learning.sqlite": bytes });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
