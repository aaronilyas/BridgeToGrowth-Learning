import { beforeAll, expect, mock, test } from "bun:test";
import { Stripe } from "stripe";
import { bootTestServer, callRoute, createTestUser, type TestServer } from "../testkit.ts";
import type { Plan } from "../../shared/api.ts";

const retrieve = mock(async (id: string) => ({ id, customer: "cus_1", status: "active", cancelAtPeriodEnd: false, periodEnd: new Date("2030-01-01T00:00:00Z") }));
const reject = async (): Promise<never> => {
  throw new Error("not mocked");
};

let t: TestServer;
let r: typeof import("./routes.ts")["billingRoutes"];
let entitlementOf: typeof import("./core.ts")["entitlementOf"];

beforeAll(async () => {
  t = await bootTestServer();
  mock.module("./stripe.ts", () => ({ fetchSubscription: retrieve, createStripeCustomer: reject, createCheckoutUrl: reject, createPortalUrl: reject, setStripeCancelAtPeriodEnd: reject }));
  r = (await import("./routes.ts")).billingRoutes;
  entitlementOf = (await import("./core.ts")).entitlementOf;
});

const post = (payload: string, sig: string) =>
  r["/api/stripe/webhook"].POST(new Request("http://127.0.0.1/api/stripe/webhook", { method: "POST", headers: { "stripe-signature": sig, "content-type": "application/json" }, body: payload }));

test("entitlementOf truth table", () => {
  const now = new Date("2026-01-10T00:00:00Z");
  const live = new Date("2026-01-11T00:00:00Z");
  const gone = new Date("2026-01-09T00:00:00Z");
  const rows: [string, Date, Plan, bigint][] = [
    ["active", gone, "pro", 15_000_000n],
    ["past_due", gone, "pro", 15_000_000n],
    ["canceled", live, "trial", 1_000_000n],
    ["canceled", gone, "none", 0n],
    ["none", live, "trial", 1_000_000n],
    ["none", gone, "none", 0n],
  ];
  for (const [sub_status, trial_ends_at, plan, capMicros] of rows) expect(entitlementOf({ sub_status, trial_ends_at }, now)).toEqual({ plan, capMicros } as never);
});

test("bad signature is 400 and writes nothing", async () => {
  await t.reset();
  const payload = JSON.stringify({ id: "evt_bad", object: "event", type: "customer.subscription.updated", data: { object: { id: "sub_1", object: "subscription" } } });
  const sig = await Stripe.webhooks.generateTestHeaderStringAsync({ payload, secret: "whsec_wrong" });
  expect((await post(payload, sig)).status).toBe(400);
  const [{ n }] = await t.sql`SELECT count(*)::int AS n FROM stripe_events`;
  expect(n).toBe(0);
});

test("replayed subscription.updated applies once", async () => {
  await t.reset();
  retrieve.mockClear();
  const u = await createTestUser();
  await t.sql`UPDATE users SET stripe_customer_id = 'cus_1' WHERE id = ${u.id}`;
  const payload = JSON.stringify({ id: "evt_1", object: "event", type: "customer.subscription.updated", data: { object: { id: "sub_1", object: "subscription", customer: "cus_1", status: "canceled" } } });
  const sig = await Stripe.webhooks.generateTestHeaderStringAsync({ payload, secret: t.env.STRIPE_WEBHOOK_SECRET });
  expect((await post(payload, sig)).status).toBe(200);
  expect((await post(payload, sig)).status).toBe(200);
  expect(retrieve).toHaveBeenCalledTimes(1);
  const [row] = await t.sql`SELECT sub_id, sub_status FROM users WHERE id = ${u.id}`;
  expect(row).toEqual({ sub_id: "sub_1", sub_status: "active" });
  const me = await callRoute(r["/api/billing"].GET, "GET", "/api/billing", { cookie: u.cookie });
  expect(await me.json()).toMatchObject({ plan: "pro", subStatus: "active", periodEnd: "2030-01-01T00:00:00.000Z" });
});
