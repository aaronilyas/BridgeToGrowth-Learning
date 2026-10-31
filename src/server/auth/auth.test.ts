import { beforeAll, expect, test } from "bun:test";
import { bootTestServer, callRoute, createTestUser, type TestServer } from "../testkit.ts";

let t: TestServer;
let r: typeof import("./routes.ts")["authRoutes"];

beforeAll(async () => {
  t = await bootTestServer();
  r = (await import("./routes.ts")).authRoutes;
});

test("signup, me, logout, then the same cookie is rejected", async () => {
  await t.reset();
  const res = await callRoute(r["/api/auth/signup"].POST, "POST", "/api/auth/signup", { body: { email: " New@Example.com ", password: "twelve chars+", turnstile: "x" } });
  expect(res.status).toBe(201);
  const set = res.headers.get("set-cookie") ?? "";
  expect(set).toContain("__Host-sid=");
  expect(set).toContain("HttpOnly; Secure; SameSite=Lax");
  const cookie = set.split(";")[0] ?? "";
  const me = await callRoute(r["/api/me"].GET, "GET", "/api/me", { cookie });
  expect(me.status).toBe(200);
  expect(await me.json()).toMatchObject({ email: "new@example.com", settings: {}, entitlement: { plan: "free", capMicros: 200_000 } });
  expect((await callRoute(r["/api/auth/logout"].POST, "POST", "/api/auth/logout", { cookie })).status).toBe(204);
  expect((await callRoute(r["/api/me"].GET, "GET", "/api/me", { cookie })).status).toBe(401);
});

test("unknown email, wrong password and a legacy placeholder hash are indistinguishable", async () => {
  await t.reset();
  const u = await createTestUser({ email: "known@example.com" });
  await t.sql`INSERT INTO users (email, pw_hash) VALUES ('legacy@example.com', 'unused')`;
  const login = async (email: string) => {
    const res = await callRoute(r["/api/auth/login"].POST, "POST", "/api/auth/login", { body: { email, password: "wrong password!!", turnstile: "x" } });
    return { status: res.status, body: await res.text() };
  };
  const a = await login(u.email);
  expect(a.status).toBe(401);
  expect(await login("nobody@example.com")).toEqual(a);
  expect(await login("legacy@example.com")).toEqual(a);
});

test("an expired session is unauthenticated", async () => {
  await t.reset();
  const u = await createTestUser();
  await t.sql`UPDATE sessions SET expires_at = now() - interval '1 minute' WHERE user_id = ${u.id}`;
  const res = await callRoute(r["/api/me"].GET, "GET", "/api/me", { cookie: u.cookie });
  expect(res.status).toBe(401);
});

test("config exposes the plan terms from env and no secrets", async () => {
  const res = await callRoute(r["/api/config"].GET, "GET", "/api/config");
  const body = await res.json();
  expect(body).toEqual({ turnstileSiteKey: t.env.TURNSTILE_SITE_KEY, passwordReset: false, plans: { free: { capMicros: 200_000, lessonTtlDays: 7 }, pro: { capMicros: 5_990_000, priceCents: 999 } } });
});
