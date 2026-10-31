import { afterAll, beforeAll, expect, mock, test } from "bun:test";
import { bootTestServer, callRoute, createTestUser, type TestServer } from "../testkit.ts";

const OLD = "correct horse battery";
const NEXT = "replacement horse";

let t: TestServer;
let account: typeof import("./account.ts")["accountRoutes"];
let auth: typeof import("./routes.ts")["authRoutes"];
// null follows env. mock.module is process-global, so a leftover true makes /api/config lie in later files.
let mailOn: boolean | null = null;
let mailOk = true;
let stripeOk = true;
const sent: { to: string; url: string }[] = [];
const deletedCustomers: string[] = [];
let seq = 0;

beforeAll(async () => {
  t = await bootTestServer();
  const { HttpError } = await import("../http.ts");
  mock.module("./mail.ts", () => ({
    passwordResetEnabled: () => mailOn ?? Boolean(t.env.RESEND_API_KEY && t.env.MAIL_FROM),
    sendPasswordReset: async (to: string, url: string) => {
      sent.push({ to, url });
      return mailOk;
    },
  }));
  mock.module("./customer.ts", () => ({
    deleteAccountCustomer: async (id: string) => {
      deletedCustomers.push(id);
      if (!stripeOk) throw new HttpError(502, "upstream");
    },
  }));
  account = (await import("./account.ts")).accountRoutes;
  auth = (await import("./routes.ts")).authRoutes;
});

afterAll(() => {
  mailOn = null;
});

function ip(): string {
  seq += 1;
  return `198.51.100.${seq}`;
}

function cookieOf(res: Response): string {
  return (res.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
}

function tokenOf(url: string): string {
  const hash = new URL(url).hash;
  return hash.startsWith("#") ? hash.slice(1) : "";
}

test("password change replaces every session and the old password", async () => {
  await t.reset();
  const u = await createTestUser({ password: OLD });
  const body = { currentPassword: "not the password", newPassword: NEXT };
  expect((await callRoute(account["/api/auth/password"].POST, "POST", "/api/auth/password", { body, ip: ip() })).status).toBe(401);
  expect((await callRoute(account["/api/auth/password"].POST, "POST", "/api/auth/password", { cookie: u.cookie, body, ip: ip() })).status).toBe(401);
  expect((await callRoute(auth["/api/me"].GET, "GET", "/api/me", { cookie: u.cookie })).status).toBe(200);
  const same = await callRoute(account["/api/auth/password"].POST, "POST", "/api/auth/password", { cookie: u.cookie, body: { currentPassword: OLD, newPassword: OLD }, ip: ip() });
  expect(same.status).toBe(400);
  const extra = await callRoute(auth["/api/auth/login"].POST, "POST", "/api/auth/login", { body: { email: u.email, password: OLD, turnstile: "x" }, ip: ip() });
  expect(extra.status).toBe(200);
  const other = cookieOf(extra);
  const changed = await callRoute(account["/api/auth/password"].POST, "POST", "/api/auth/password", { cookie: u.cookie, body: { currentPassword: OLD, newPassword: NEXT }, ip: ip() });
  expect(changed.status).toBe(200);
  const fresh = cookieOf(changed);
  expect(fresh).toContain("__Host-sid=");
  expect((await callRoute(auth["/api/me"].GET, "GET", "/api/me", { cookie: u.cookie })).status).toBe(401);
  expect((await callRoute(auth["/api/me"].GET, "GET", "/api/me", { cookie: other })).status).toBe(401);
  expect((await callRoute(auth["/api/me"].GET, "GET", "/api/me", { cookie: fresh })).status).toBe(200);
  const stale = await callRoute(auth["/api/auth/login"].POST, "POST", "/api/auth/login", { body: { email: u.email, password: OLD, turnstile: "x" }, ip: ip() });
  const again = await callRoute(auth["/api/auth/login"].POST, "POST", "/api/auth/login", { body: { email: u.email, password: NEXT, turnstile: "x" }, ip: ip() });
  expect(stale.status).toBe(401);
  expect(again.status).toBe(200);
});

test("a reset link is stored as a hash, works once, and dies with the password or the mail send", async () => {
  await t.reset();
  mailOn = false;
  mailOk = true;
  sent.length = 0;
  const u = await createTestUser({ email: "reset@example.com", password: OLD });
  const forgot = (email: string) => callRoute(account["/api/auth/forgot"].POST, "POST", "/api/auth/forgot", { body: { email, turnstile: "x" }, ip: ip() });
  expect((await forgot(u.email)).status).toBe(204);
  expect(sent).toEqual([]);
  const quiet: { n: number }[] = await t.sql`SELECT count(*)::int AS n FROM password_resets WHERE user_id = ${u.id}`;
  expect(quiet[0]?.n).toBe(0);

  mailOn = true;
  const unknown = await forgot("nobody-reset@example.com");
  const known = await forgot(u.email);
  expect(unknown.status).toBe(known.status);
  expect(await unknown.text()).toBe(await known.text());
  expect(sent.map((m) => m.to)).toEqual([u.email]);
  const link = sent[0]?.url ?? "";
  expect(link.startsWith(`${t.env.APP_ORIGIN}/reset#`)).toBe(true);
  const token = tokenOf(link);
  const stored: { hex: string }[] = await t.sql`SELECT encode(token_hash, 'hex') AS hex FROM password_resets WHERE user_id = ${u.id}`;
  expect(stored[0]?.hex).toBe(new Bun.CryptoHasher("sha256").update(token).digest("hex"));
  await t.sql`UPDATE password_resets SET expires_at = now() - interval '1 minute' WHERE user_id = ${u.id}`;
  const expired = await callRoute(account["/api/auth/reset"].POST, "POST", "/api/auth/reset", { body: { token, password: NEXT }, ip: ip() });
  expect(expired.status).toBe(400);

  sent.length = 0;
  expect((await forgot(u.email)).status).toBe(204);
  const live = tokenOf(sent[0]?.url ?? "");
  const reset = await callRoute(account["/api/auth/reset"].POST, "POST", "/api/auth/reset", { body: { token: live, password: NEXT }, ip: ip() });
  expect(reset.status).toBe(200);
  expect((await callRoute(auth["/api/me"].GET, "GET", "/api/me", { cookie: u.cookie })).status).toBe(401);
  expect((await callRoute(auth["/api/me"].GET, "GET", "/api/me", { cookie: cookieOf(reset) })).status).toBe(200);
  expect((await callRoute(account["/api/auth/reset"].POST, "POST", "/api/auth/reset", { body: { token: live, password: "another password" }, ip: ip() })).status).toBe(400);

  const dropped = await createTestUser({ password: OLD });
  mailOk = false;
  sent.length = 0;
  expect((await forgot(dropped.email)).status).toBe(204);
  expect(sent.length).toBe(1);
  const left: { n: number }[] = await t.sql`SELECT count(*)::int AS n FROM password_resets WHERE user_id = ${dropped.id}`;
  expect(left[0]?.n).toBe(0);

  mailOk = true;
  const owned = await createTestUser({ password: OLD });
  sent.length = 0;
  expect((await forgot(owned.email)).status).toBe(204);
  const pending = tokenOf(sent[0]?.url ?? "");
  const { setUserPassword } = await import("./sql.ts");
  expect(await setUserPassword(owned.email, await Bun.password.hash("operator sets this", "argon2id"))).toBe(true);
  expect((await callRoute(account["/api/auth/reset"].POST, "POST", "/api/auth/reset", { body: { token: pending, password: NEXT }, ip: ip() })).status).toBe(400);
  const login = await callRoute(auth["/api/auth/login"].POST, "POST", "/api/auth/login", { body: { email: owned.email, password: "operator sets this", turnstile: "x" }, ip: ip() });
  expect(login.status).toBe(200);
});

test("account deletion requires the password and cancels Stripe before removing the user", async () => {
  await t.reset();
  deletedCustomers.length = 0;
  stripeOk = true;
  expect((await callRoute(account["/api/account"].DELETE, "DELETE", "/api/account", { body: { password: OLD }, ip: ip() })).status).toBe(401);
  const a = await createTestUser({ password: OLD });
  const wrong = await callRoute(account["/api/account"].DELETE, "DELETE", "/api/account", { cookie: a.cookie, body: { password: "nope nope nope" }, ip: ip() });
  expect(wrong.status).toBe(401);
  expect(deletedCustomers).toEqual([]);
  const kept: { n: number }[] = await t.sql`SELECT count(*)::int AS n FROM users WHERE id = ${a.id}`;
  expect(kept[0]?.n).toBe(1);
  const gone = await callRoute(account["/api/account"].DELETE, "DELETE", "/api/account", { cookie: a.cookie, body: { password: OLD }, ip: ip() });
  expect(gone.status).toBe(204);
  expect(gone.headers.get("set-cookie") ?? "").toContain("Max-Age=0");
  expect(deletedCustomers).toEqual([]);
  const removed: { n: number }[] = await t.sql`SELECT count(*)::int AS n FROM users WHERE id = ${a.id}`;
  expect(removed[0]?.n).toBe(0);
  expect((await callRoute(auth["/api/me"].GET, "GET", "/api/me", { cookie: a.cookie })).status).toBe(401);

  const b = await createTestUser({ password: OLD });
  await t.sql`UPDATE users SET stripe_customer_id = 'cus_del' WHERE id = ${b.id}`;
  await t.sql`INSERT INTO topics (user_id, slug, name, domain) VALUES (${b.id}, 'keep', 'Keep', 'math')`;
  stripeOk = false;
  const blocked = await callRoute(account["/api/account"].DELETE, "DELETE", "/api/account", { cookie: b.cookie, body: { password: OLD }, ip: ip() });
  expect(blocked.status).toBe(502);
  expect(deletedCustomers).toEqual(["cus_del"]);
  const still: { n: number }[] = await t.sql`SELECT count(*)::int AS n FROM users WHERE id = ${b.id}`;
  expect(still[0]?.n).toBe(1);
  stripeOk = true;
  deletedCustomers.length = 0;
  const ok = await callRoute(account["/api/account"].DELETE, "DELETE", "/api/account", { cookie: b.cookie, body: { password: OLD }, ip: ip() });
  expect(ok.status).toBe(204);
  expect(deletedCustomers).toEqual(["cus_del"]);
  const users: { n: number }[] = await t.sql`SELECT count(*)::int AS n FROM users WHERE id = ${b.id}`;
  const topics: { n: number }[] = await t.sql`SELECT count(*)::int AS n FROM topics WHERE user_id = ${b.id}`;
  expect(users[0]?.n).toBe(0);
  expect(topics[0]?.n).toBe(0);
});
