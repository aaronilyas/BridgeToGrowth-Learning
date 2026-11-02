import type { sql as Sql } from "./db.ts";
import type { env as Env } from "./env.ts";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LOCAL_EMAIL, LOCAL_USER_ID } from "./profile.ts";

export const TEST_ORIGIN = "https://app.test";
const FIXTURE_USER_ID = "00000000-0000-4000-8000-000000000002";

export type TestServer = { sql: typeof Sql; env: typeof Env; reset: () => Promise<void> };
export type TestUser = { id: string; email: string; cookie: string };
export type CallOpts = { body?: unknown; cookie?: string; origin?: string; ip?: string };
export type Handler = (req: Request) => Promise<Response>;

// INV: every variable env.ts requires; test-only values
export const TEST_ENV: Record<string, string> = {
  NODE_ENV: "test",
  APP_ORIGIN: TEST_ORIGIN,
  OPENROUTER_API_KEY: "k",
  OPENROUTER_BASE_URL: "https://openrouter.ai/api/v1",
  OPENROUTER_MODEL: "openrouter/free",
};

// O(tables)
// INV: app rows go away and the seeded local profile comes back; the migration ledger stays
async function clearAppRows(db: typeof Sql): Promise<void> {
  await db.begin(async (tx) => {
    await tx`DELETE FROM messages`;
    await tx`DELETE FROM lesson_steps`;
    await tx`DELETE FROM conversations`;
    await tx`DELETE FROM attempts`;
    await tx`DELETE FROM cards`;
    await tx`DELETE FROM questions`;
    await tx`DELETE FROM lessons`;
    await tx`DELETE FROM topic_edges`;
    await tx`DELETE FROM topics`;
    await tx`DELETE FROM styles`;
    await tx`DELETE FROM daily_activity`;
    await tx`DELETE FROM insights`;
    await tx`DELETE FROM llm_calls`;
    await tx`DELETE FROM usage_periods`;
    await tx`DELETE FROM papers`;
    await tx`DELETE FROM retrieval_cache`;
    await tx`DELETE FROM users`;
    await tx`INSERT INTO users (id, email, settings, created_at) VALUES (${LOCAL_USER_ID}, ${LOCAL_EMAIL}, '{}', 0)`;
  });
}

// O(1)
// INV: each call opens a new temp database before server modules use it
export async function bootTestServer(): Promise<TestServer> {
  process.env.BTG_DATA_DIR = mkdtempSync(join(tmpdir(), "btg-"));
  Object.assign(process.env, TEST_ENV);
  const { activateDatabase, sql } = await import("./db.ts");
  await activateDatabase();
  const { env } = await import("./env.ts");
  const reset = (): Promise<void> => clearAppRows(sql);
  await reset();
  return { sql, env, reset };
}

// O(1)
// INV: one local profile; tests share its id and do not insert an auth user
export async function createTestUser(): Promise<TestUser> {
  return { id: LOCAL_USER_ID, email: LOCAL_EMAIL, cookie: "" };
}

// O(1)
// INV: a second users row so queries can still prove a user_id predicate hides foreign rows
export async function insertFixtureUser(db: typeof Sql): Promise<string> {
  await db`INSERT INTO users (id, email, settings, created_at) VALUES (${FIXTURE_USER_ID}, 'other@localhost', '{}', 0)`;
  return FIXTURE_USER_ID;
}

// O(1) plus handler cost
export async function callRoute(handler: Handler, method: string, path: string, o: CallOpts = {}): Promise<Response> {
  const headers: Record<string, string> = { origin: o.origin ?? TEST_ORIGIN, "x-real-ip": o.ip ?? "203.0.113.1" };
  if (o.body !== undefined) headers["content-type"] = "application/json";
  if (o.cookie) headers.cookie = o.cookie;
  const init: RequestInit = { method, headers };
  if (o.body !== undefined) init.body = JSON.stringify(o.body);
  return handler(new Request(`http://127.0.0.1${path}`, init));
}
