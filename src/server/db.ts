import { SQL } from "bun";
import { databasePath } from "./paths.ts";
import { runMigrations } from "../../scripts/migrate.ts";

export const sql = new SQL(`sqlite://${databasePath()}`);
// INV: user_id remains on surviving tables because removing it requires rewriting every query and constraint; the only profile id is local.
await sql`PRAGMA journal_mode=WAL`;
await sql`PRAGMA foreign_keys=ON`;
await sql`PRAGMA busy_timeout=5000`;
await runMigrations(sql);
