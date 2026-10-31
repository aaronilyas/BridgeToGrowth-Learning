import { beforeAll, expect, mock, test } from "bun:test";
import { Stripe } from "stripe";
import { bootTestServer, callRoute, createTestUser, type Handler, type TestServer } from "../testkit.ts";

type Snap = { id: string; customer: string; status: string; cancelAtPeriodEnd: boolean; periodEnd: Date | null };
const snaps = new Map<string, Snap>();
const retrieve = mock(async (id: string): Promise<Snap> => {
  const s = snaps.get(id);
  if (!s) throw new Error(`no snapshot for ${id}`);
  return s;
});
const reject = async (): Promise<never> => {
  throw new Error("not mocked");
};

let t: TestServer;
let r: typeof import("./routes.ts")["billingRoutes"];
let core: typeof import("./core.ts");
let gates: { putSettings: Handler; stats: Handler; insights: Handler };
let teachSql: typeof import("../teach/sql.ts");

beforeAll(async () => {
  t = await bootTestServer();
  mock.module("./stripe.ts", () => ({ fetchSubscription: retrieve, findCustomerSubscription: reject, createStripeCustomer: reject, createCheckoutUrl: reject, createPortalUrl: reject, setStripeCancelAtPeriodEnd: reject, deleteStripeCustomer: reject }));
  mock.module("../llm/gateway.ts", () => ({ chatJson: reject, chatStream: reject, startPricingRefresh: () => {}, assertQuotaHeadroom: async () => {} }));
  r = (await import("./routes.ts")).billingRoutes;
  core = await import("./core.ts");
  teachSql = await import("../teach/sql.ts");
  const { learnRoutes } = await import("../learn/routes.ts");
  const { statsRoutes } = await import("../stats/routes.ts");
  gates = { putSettings: learnRoutes["/api/settings"].PUT, stats: statsRoutes["/api/stats"].GET, insights: statsRoutes["/api/insights"].GET };
});

const post = (payload: string, sig: string) =>
  r["/api/stripe/webhook"].POST(new Request("http://127.0.0.1/api/stripe/webhook", { method: "POST", headers: { "stripe-signature": sig, "content-type": "application/json" }, body: payload }));

async function deliver(eventId: string, subId: string, secret: string = t.env.STRIPE_WEBHOOK_SECRET): Promise<Response> {
  const payload = JSON.stringify({ id: eventId, object: "event", type: "customer.subscription.updated", data: { object: { id: subId, object: "subscription", status: "canceled" } } });
  return post(payload, await Stripe.webhooks.generateTestHeaderStringAsync({ payload, secret }));
}

async function addLesson(uid: string, expiresAt: string | null): Promise<string> {
  const plan = { title: "T", topic: { name: "X", domain: "math" }, related: [], steps: [{ title: "s", summary: "s" }] };
  const [topic] = await t.sql`INSERT INTO topics (user_id, slug, name, domain) VALUES (${uid}, ${`t-${crypto.randomUUID()}`}, 'X', 'math') RETURNING id`;
  const [lesson] = await t.sql`INSERT INTO lessons (user_id, topic_id, title, plan, model, expires_at) VALUES (${uid}, ${topic.id}, 'T', ${JSON.stringify(plan)}::text::jsonb, 'm', ${expiresAt}::timestamptz) RETURNING id`;
  return lesson.id;
}

test("entitlementOf truth table uses the env caps", () => {
  const rows: [string, "free" | "pro", bigint][] = [
    ["active", "pro", 5_990_000n],
    ["trialing", "pro", 5_990_000n],
    ["past_due", "pro", 5_990_000n],
    ["canceled", "free", 200_000n],
    ["unpaid", "free", 200_000n],
    ["incomplete", "free", 200_000n],
    ["none", "free", 200_000n],
  ];
  for (const [sub_status, plan, capMicros] of rows) expect([sub_status, core.entitlementOf({ sub_status })]).toEqual([sub_status, { plan, capMicros }]);
  const now = new Date("2026-01-01T00:00:00Z");
  expect(core.computeLessonExpiry("free", now)).toEqual(new Date("2026-01-08T00:00:00Z"));
  expect(core.computeLessonExpiry("pro", now)).toBeNull();
});

test("bad signature is 400 and writes nothing", async () => {
  await t.reset();
  expect((await deliver("evt_bad", "sub_1", "whsec_wrong")).status).toBe(400);
  const [{ n }] = await t.sql`SELECT count(*)::int AS n FROM stripe_events`;
  expect(n).toBe(0);
});

test("a replayed event applies once, upgrades to pro and keeps free lessons", async () => {
  await t.reset();
  retrieve.mockClear();
  const u = await createTestUser();
  await t.sql`UPDATE users SET stripe_customer_id = 'cus_1' WHERE id = ${u.id}`;
  const expiring = await addLesson(u.id, "2099-01-01T00:00:00Z");
  snaps.set("sub_1", { id: "sub_1", customer: "cus_1", status: "active", cancelAtPeriodEnd: false, periodEnd: new Date("2030-01-01T00:00:00Z") });
  expect((await deliver("evt_1", "sub_1")).status).toBe(200);
  expect((await deliver("evt_1", "sub_1")).status).toBe(200);
  expect(retrieve).toHaveBeenCalledTimes(1);
  const [row] = await t.sql`SELECT sub_id, sub_status FROM users WHERE id = ${u.id}`;
  expect(row).toEqual({ sub_id: "sub_1", sub_status: "active" });
  const [lesson] = await t.sql`SELECT expires_at FROM lessons WHERE id = ${expiring}`;
  expect(lesson.expires_at).toBeNull();
  const res = await callRoute(r["/api/billing"].GET, "GET", "/api/billing", { cookie: u.cookie });
  expect(await res.json()).toEqual({ plan: "pro", subStatus: "active", periodEnd: "2030-01-01T00:00:00.000Z", cancelAtPeriodEnd: false, hasCustomer: true });
});

test("a canceled duplicate subscription does not downgrade a paying user", async () => {
  await t.reset();
  const u = await createTestUser();
  await t.sql`UPDATE users SET stripe_customer_id = 'cus_2', sub_id = 'sub_live', sub_status = 'active' WHERE id = ${u.id}`;
  snaps.set("sub_dup", { id: "sub_dup", customer: "cus_2", status: "canceled", cancelAtPeriodEnd: false, periodEnd: null });
  expect((await deliver("evt_dup", "sub_dup")).status).toBe(200);
  const [kept] = await t.sql`SELECT sub_id, sub_status FROM users WHERE id = ${u.id}`;
  expect(kept).toEqual({ sub_id: "sub_live", sub_status: "active" });
  snaps.set("sub_live", { id: "sub_live", customer: "cus_2", status: "canceled", cancelAtPeriodEnd: false, periodEnd: null });
  expect((await deliver("evt_end", "sub_live")).status).toBe(200);
  const [ended] = await t.sql`SELECT sub_status FROM users WHERE id = ${u.id}`;
  expect(ended.sub_status).toBe("canceled");
});

test("settings writes and personal stats are pro only", async () => {
  await t.reset();
  const free = await createTestUser();
  const pro = await createTestUser({ plan: "pro" });
  const patch = { body: { practice: { dailyGoal: 12 } } };
  expect((await callRoute(gates.putSettings, "PUT", "/api/settings", { cookie: free.cookie, ...patch })).status).toBe(402);
  expect((await callRoute(gates.stats, "GET", "/api/stats", { cookie: free.cookie })).status).toBe(402);
  expect((await callRoute(gates.insights, "GET", "/api/insights", { cookie: free.cookie })).status).toBe(402);
  expect((await callRoute(gates.putSettings, "PUT", "/api/settings", { cookie: pro.cookie, ...patch })).status).toBe(200);
  expect((await callRoute(gates.stats, "GET", "/api/stats", { cookie: pro.cookie })).status).toBe(200);
});

test("expired free lessons are hidden at once and deleted by the sweeper", async () => {
  await t.reset();
  const u = await createTestUser();
  const gone = await addLesson(u.id, "2000-01-01T00:00:00Z");
  const live = await addLesson(u.id, "2099-01-01T00:00:00Z");
  const kept = await addLesson(u.id, null);
  expect(await teachSql.findLesson(u.id, gone)).toBeNull();
  expect((await teachSql.listLessons(u.id, 20)).map((l) => l.id).sort()).toEqual([live, kept].sort());
  expect(await teachSql.deleteExpiredLessons()).toBe(1);
  const ids = (await t.sql`SELECT id FROM lessons WHERE user_id = ${u.id}`).map((l: { id: string }) => l.id).sort();
  expect(ids).toEqual([live, kept].sort());
});

test("the free plan cannot pick a model", async () => {
  const { resolveModel } = await import("../learn/core.ts");
  const { MODELS } = await import("../llm/models.ts");
  const { Settings } = await import("../../shared/settings.ts");
  const [first, second] = MODELS;
  if (!first || !second) throw new Error("need two models");
  const s = Settings.parse({});
  expect(resolveModel(s, "free")).toBe(first.id);
  expect(resolveModel(s, "free", first.id)).toBe(first.id);
  expect(() => resolveModel(s, "free", second.id)).toThrow("pro_required");
  expect(resolveModel({ ...s, model: second.id }, "pro")).toBe(second.id);
});
