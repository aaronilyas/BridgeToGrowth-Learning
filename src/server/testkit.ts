import type { sql as Sql } from "./db.ts";
import type { env as Env } from "./env.ts";
import { LOCAL_EMAIL, LOCAL_USER_ID } from "./profile.ts";

export const TEST_ORIGIN = "https://app.test";

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

// O(1)
// INV: sets env before any server module is imported; DATABASE_URL is TEST_DATABASE_URL
export async function bootTestServer(): Promise<TestServer> {
  const testDb = process.env.TEST_DATABASE_URL;
  if (!testDb) throw new Error("TEST_DATABASE_URL is required");
  Object.assign(process.env, TEST_ENV, { DATABASE_URL: testDb });
  const { sql } = await import("./db.ts");
  const { env } = await import("./env.ts");
  const reset = async (): Promise<void> => {
    await sql`TRUNCATE users, papers, retrieval_cache CASCADE`;
  };
  await reset();
  return { sql, env, reset };
}

// O(1)
// INV: one local profile; tests share its id and do not insert an auth user
export async function createTestUser(): Promise<TestUser> {
  return { id: LOCAL_USER_ID, email: LOCAL_EMAIL, cookie: "" };
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
