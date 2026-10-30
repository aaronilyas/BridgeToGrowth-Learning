import type { sql as Sql } from "./db.ts";
import type { env as Env } from "./env.ts";

export const TEST_ORIGIN = "https://app.test";

export type TestServer = { sql: typeof Sql; env: typeof Env; reset: () => Promise<void> };
export type TestUser = { id: string; email: string };
export type CallOpts = { body?: unknown; cookie?: string; origin?: string; ip?: string };
export type Handler = (req: Request) => Promise<Response>;

// O(1)
// INV: sets env before any server module is imported; DATABASE_URL is TEST_DATABASE_URL
export async function bootTestServer(): Promise<TestServer> {
  const testDb = process.env.TEST_DATABASE_URL;
  if (!testDb) throw new Error("TEST_DATABASE_URL is required");
  Object.assign(process.env, {
    NODE_ENV: "test",
    APP_ORIGIN: TEST_ORIGIN,
    DATABASE_URL: testDb,
    OPENROUTER_API_KEY: "k",
    OPENROUTER_BASE_URL: "https://openrouter.ai/api/v1",
    OPENROUTER_MODEL: "openrouter/free",
    OPENALEX_MAILTO: "a@example.com",
  });
  const { sql } = await import("./db.ts");
  const { env } = await import("./env.ts");
  const reset = async (): Promise<void> => {
    await sql`TRUNCATE users, papers, retrieval_cache CASCADE`;
  };
  await reset();
  return { sql, env, reset };
}

// O(1)
// INV: every test actor is the single local user
export async function createTestUser(): Promise<TestUser> {
  const { ensureLocalUser } = await import("./local/sql.ts");
  const user = await ensureLocalUser();
  return { id: user.id, email: user.email };
}

// O(1)
// INV: this row is never the user that routes act as
export async function createOtherUser(): Promise<TestUser> {
  const { sql } = await import("./db.ts");
  const email = `other-${crypto.randomUUID()}@example.com`;
  const rows: { id: string; email: string }[] = await sql`
    INSERT INTO users (email, pw_hash, trial_ends_at)
    VALUES (${email}, 'unused', now())
    RETURNING id, email`;
  const row = rows[0];
  if (!row) throw new Error("other user missing");
  return row;
}

// O(1) plus handler cost
export async function callRoute(handler: Handler, method: string, path: string, o: CallOpts = {}): Promise<Response> {
  const headers: Record<string, string> = { origin: o.origin ?? TEST_ORIGIN };
  if (o.body !== undefined) headers["content-type"] = "application/json";
  if (o.cookie) headers.cookie = o.cookie;
  const init: RequestInit = { method, headers };
  if (o.body !== undefined) init.body = JSON.stringify(o.body);
  return handler(new Request(`http://127.0.0.1${path}`, init));
}
