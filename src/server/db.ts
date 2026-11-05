import { SQL } from "bun";
import { databasePath } from "./paths.ts";
import { runMigrations } from "../../scripts/migrate.ts";

let boundPath = databasePath();
let inner: SQL | null = new SQL(`sqlite://${boundPath}`);
let migrated = false;

// O(migrations)
// INV: the connection object exists at import (module-level sql fragments need it); callers (startServer, the test kit) run activateDatabase before the first query. No top-level await: the desktop bundle cannot hoist it
// INV: user_id stays on every per-user table and stores the single local profile id; dropping the column would rewrite every query, so the predicate remains and the id does not vary
export async function activateDatabase(path: string = databasePath()): Promise<void> {
  if (inner && boundPath === path) {
    if (!migrated) await runMigrations(inner);
    migrated = true;
    return;
  }
  const prev = inner;
  const next = new SQL(`sqlite://${path}`);
  try {
    await runMigrations(next);
  } catch (error) {
    await next.close();
    throw error;
  }
  inner = next;
  boundPath = path;
  migrated = true;
  if (prev) await prev.close();
}

function live(): SQL {
  if (!inner) throw new Error("database is closed");
  return inner;
}

export const sql = new Proxy(function () {} as unknown as SQL, {
  apply(_target, _thisArg, args: unknown[]) {
    const db = live() as unknown as (...a: unknown[]) => unknown;
    return db.apply(live(), args);
  },
  get(_target, prop) {
    const db = live() as unknown as Record<PropertyKey, unknown>;
    const value = db[prop];
    if (typeof value === "function") return (value as (...a: unknown[]) => unknown).bind(db);
    return value;
  },
}) as SQL;
