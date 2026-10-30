import { mock } from "bun:test";
import type { sql as Sql } from "./db.ts";
import type { env as Env } from "./env.ts";

export const TEST_ORIGIN = "https://app.test";

export type TestServer = { sql: typeof Sql; env: typeof Env; reset: () => Promise<void> };
export type TestUser = { id: string; email: string; cookie: string };
export type CallOpts = { body?: unknown; cookie?: string; origin?: string; ip?: string };
export type Handler = (req: Request) => Promise<Response>;

// O(1)
// INV: sets env before any server module is imported; DATABASE_URL is TEST_DATABASE_URL; verifyTurnstile resolves true
export async function bootTestServer(): Promise<TestServer> {
  const testDb = process.env.TEST_DATABASE_URL;
  if (!testDb) throw new Error("TEST_DATABASE_URL is required");
  Object.assign(process.env, {
    NODE_ENV: "test",
    APP_ORIGIN: TEST_ORIGIN,
    DATABASE_URL: testDb,
    OPENROUTER_API_KEY: "k",
    STRIPE_SECRET_KEY: "sk_test_x",
    STRIPE_WEBHOOK_SECRET: "whsec_x",
    STRIPE_PRICE_ID: "price_x",
    TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
    TURNSTILE_SECRET: "1x0000000000000000000000000000000AA",
    OPENALEX_MAILTO: "a@example.com",
  });
  mock.module("./auth/turnstile.ts", () => ({ verifyTurnstile: async () => true }));
  const { sql } = await import("./db.ts");
  const { env } = await import("./env.ts");
  const reset = async (): Promise<void> => {
    await sql`TRUNCATE users, papers, retrieval_cache, stripe_events CASCADE`;
  };
  await reset();
  return { sql, env, reset };
}

// O(1) plus one cheap argon2id hash
// SEC: test-only low-cost hash parameters
export async function createTestUser(email: string = `u${crypto.randomUUID()}@example.com`, password: string = "correct horse battery"): Promise<TestUser> {
  const { insertUser, insertSession } = await import("./auth/sql.ts");
  const { createToken, hashToken } = await import("./auth/core.ts");
  const hash = await Bun.password.hash(password, { algorithm: "argon2id", memoryCost: 1024, timeCost: 1 });
  const user = await insertUser(email, hash, 7);
  if (!user) throw new Error("test user exists");
  const token = createToken();
  await insertSession(user.id, hashToken(token));
  return { id: user.id, email: user.email, cookie: `__Host-sid=${token}` };
}

// O(1) plus handler cost
export async function callRoute(handler: Handler, method: string, path: string, o: CallOpts = {}): Promise<Response> {
  const headers: Record<string, string> = { origin: o.origin ?? TEST_ORIGIN, "cf-connecting-ip": o.ip ?? "203.0.113.1" };
  if (o.body !== undefined) headers["content-type"] = "application/json";
  if (o.cookie) headers.cookie = o.cookie;
  const init: RequestInit = { method, headers };
  if (o.body !== undefined) init.body = JSON.stringify(o.body);
  return handler(new Request(`http://127.0.0.1${path}`, init));
}
