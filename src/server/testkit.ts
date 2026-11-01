import { mock } from "bun:test";
import type { sql as Sql } from "./db.ts";
import type { env as Env } from "./env.ts";

export const TEST_ORIGIN = "https://app.test";

export type TestServer = { sql: typeof Sql; env: typeof Env; reset: () => Promise<void> };
export type TestUser = { id: string; email: string; cookie: string };
export type CallOpts = { body?: unknown; cookie?: string; origin?: string; ip?: string };
export type Handler = (req: Request) => Promise<Response>;

// INV: every variable env.ts requires; test-only values, Turnstile uses Cloudflare's always-pass test keys
export const TEST_ENV: Record<string, string> = {
  NODE_ENV: "test",
  APP_ORIGIN: TEST_ORIGIN,
  OPENROUTER_API_KEY: "k",
  OPENROUTER_BASE_URL: "https://openrouter.ai/api/v1",
  OPENROUTER_MODEL: "openrouter/free",
  OPENALEX_MAILTO: "a@example.com",
  STRIPE_SECRET_KEY: "sk_test_x",
  STRIPE_WEBHOOK_SECRET: "whsec_x",
  STRIPE_PRICE_ID: "price_x",
  TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
  TURNSTILE_SECRET: "1x0000000000000000000000000000000AA",
  FREE_CAP_USD: "0.20",
  PRO_CAP_USD: "5.99",
  PRO_PRICE_USD: "9.99",
  FREE_LESSON_TTL_DAYS: "7",
};

// O(1)
// INV: sets env before any server module is imported; DATABASE_URL is TEST_DATABASE_URL; verifyTurnstile rejects the token "bad" and accepts every other token
export async function bootTestServer(): Promise<TestServer> {
  const testDb = process.env.TEST_DATABASE_URL;
  if (!testDb) throw new Error("TEST_DATABASE_URL is required");
  Object.assign(process.env, TEST_ENV, { DATABASE_URL: testDb });
  mock.module("./auth/turnstile.ts", () => ({ verifyTurnstile: async (token: string) => token !== "bad" }));
  const { sql } = await import("./db.ts");
  const { env } = await import("./env.ts");
  const reset = async (): Promise<void> => {
    await sql`TRUNCATE users, papers, retrieval_cache, stripe_events CASCADE`;
  };
  await reset();
  return { sql, env, reset };
}

// O(1) plus one cheap argon2id hash
// SEC: test-only low-cost hash parameters; plan "pro" stores an active subscription so entitlementOf grants pro
export async function createTestUser(o: { email?: string; password?: string; plan?: "free" | "pro" } = {}): Promise<TestUser> {
  const { insertUser, insertSession } = await import("./auth/sql.ts");
  const { createToken, hashToken } = await import("./auth/core.ts");
  const hash = await Bun.password.hash(o.password ?? "correct horse battery", { algorithm: "argon2id", memoryCost: 1024, timeCost: 1 });
  const user = await insertUser(o.email ?? `u${crypto.randomUUID()}@example.com`, hash);
  if (!user) throw new Error("test user exists");
  if (o.plan === "pro") {
    const { sql } = await import("./db.ts");
    await sql`UPDATE users SET stripe_customer_id = ${`cus_${user.id}`}, sub_id = ${`sub_${user.id}`}, sub_status = 'active' WHERE id = ${user.id}`;
  }
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
