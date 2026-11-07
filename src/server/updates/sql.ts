import { sql } from "../db.ts";

// O(n) in the database size
// INV: VACUUM INTO writes a consistent copy while the app keeps running; the target must not exist yet
export async function snapshotDatabase(path: string): Promise<void> {
  await sql`VACUUM INTO ${path}`;
}
