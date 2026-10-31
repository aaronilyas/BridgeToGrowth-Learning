import { Stripe } from "stripe";
import { env } from "../env.ts";
import { HttpError } from "../http.ts";
import { isProStatus, snapshotSubscription, type SubSnapshot } from "./core.ts";

// INV: the only Stripe client; the SDK's pinned default apiVersion
const stripe = new Stripe(env.STRIPE_SECRET_KEY, { maxNetworkRetries: 2, timeout: 20_000 });

// O(1) network call
// SEC: Stripe error messages are logged by type only and surface as 502 upstream
async function callStripe<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    console.error(`stripe error: ${e instanceof Stripe.errors.StripeError ? e.type : "unknown"}`);
    throw new HttpError(502, "upstream");
  }
}

// O(1) network call
// INV: idempotency key cust-${uid} makes concurrent creation return one customer
export async function createStripeCustomer(uid: string, email: string): Promise<string> {
  const c = await callStripe(() => stripe.customers.create({ email, metadata: { uid } }, { idempotencyKey: `cust-${uid}` }));
  return c.id;
}

// O(1) network call
export async function createCheckoutUrl(customer: string, uid: string): Promise<string> {
  const s = await callStripe(() =>
    stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: env.STRIPE_PRICE_ID, quantity: 1 }],
      customer,
      client_reference_id: uid,
      subscription_data: { metadata: { uid } },
      success_url: `${env.APP_ORIGIN}/billing?ok=1`,
      cancel_url: `${env.APP_ORIGIN}/billing`,
    }),
  );
  if (!s.url) throw new HttpError(502, "upstream");
  return s.url;
}

// O(1) network call
export async function createPortalUrl(customer: string): Promise<string> {
  const s = await callStripe(() => stripe.billingPortal.sessions.create({ customer, return_url: `${env.APP_ORIGIN}/billing` }));
  return s.url;
}

// O(1) network call
export async function fetchSubscription(id: string): Promise<SubSnapshot> {
  return snapshotSubscription(await callStripe(() => stripe.subscriptions.retrieve(id)));
}

// O(k) network call, k <= 10 subscriptions
// INV: prefers a subscription that grants pro, else the newest one; null when the customer has none
export async function findCustomerSubscription(customer: string): Promise<SubSnapshot | null> {
  const list = await callStripe(() => stripe.subscriptions.list({ customer, status: "all", limit: 10 }));
  const subs = list.data.map(snapshotSubscription);
  return subs.find((s) => isProStatus(s.status)) ?? subs[0] ?? null;
}

// O(1) network call
export async function setStripeCancelAtPeriodEnd(id: string, cancel: boolean): Promise<SubSnapshot> {
  return snapshotSubscription(await callStripe(() => stripe.subscriptions.update(id, { cancel_at_period_end: cancel })));
}

// O(1) network call
// INV: a missing customer is already gone, so account deletion can continue; any other Stripe failure leaves the account in place
// SEC: Stripe error messages are logged by type only
export async function deleteStripeCustomer(customer: string): Promise<void> {
  try {
    await stripe.customers.del(customer);
  } catch (e) {
    if (e instanceof Stripe.errors.StripeError && e.code === "resource_missing") return;
    console.error(`stripe error: ${e instanceof Stripe.errors.StripeError ? e.type : "unknown"}`);
    throw new HttpError(502, "upstream");
  }
}
