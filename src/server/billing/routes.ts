import { Stripe } from "stripe";
import type { AuthUser } from "../auth/core.ts";
import { env } from "../env.ts";
import { HttpError, json, readBodyCapped, route } from "../http.ts";
import { formatBilling, isProStatus } from "./core.ts";
import { applyStripeEvent, claimCustomerId, saveUserSubscription } from "./sql.ts";
import { createCheckoutUrl, createPortalUrl, createStripeCustomer, fetchSubscription, findCustomerSubscription, setStripeCancelAtPeriodEnd } from "./stripe.ts";

const WEBHOOK_MAX = 2 ** 20;
const cryptoProvider = Stripe.createSubtleCryptoProvider();

async function ensureCustomer(u: AuthUser): Promise<string> {
  if (u.stripe_customer_id) return u.stripe_customer_id;
  return claimCustomerId(u.id, await createStripeCustomer(u.id, u.email));
}

async function setCancel(u: AuthUser, cancel: boolean): Promise<Response> {
  if (!u.sub_id || !u.stripe_customer_id) throw new HttpError(404, "not_found");
  const row = await saveUserSubscription(u.id, u.stripe_customer_id, await setStripeCancelAtPeriodEnd(u.sub_id, cancel));
  if (!row) throw new HttpError(404, "not_found");
  return json(formatBilling(row));
}

const billing = route({ auth: true }, async (c) => json(formatBilling(c.user)));

const checkout = route({ auth: true, rate: { key: "checkout", cap: 10, perMin: 10 } }, async (c) => {
  if (c.plan === "pro") throw new HttpError(409, "already_subscribed");
  if (c.user.stripe_customer_id) {
    const sub = await findCustomerSubscription(c.user.stripe_customer_id);
    if (sub && isProStatus(sub.status)) {
      await saveUserSubscription(c.user.id, c.user.stripe_customer_id, sub);
      throw new HttpError(409, "already_subscribed");
    }
  }
  return json({ url: await createCheckoutUrl(await ensureCustomer(c.user), c.user.id) });
});

const portal = route({ auth: true, rate: { key: "portal", cap: 10, perMin: 10 } }, async (c) => {
  if (!c.user.stripe_customer_id) throw new HttpError(404, "not_found");
  return json({ url: await createPortalUrl(c.user.stripe_customer_id) });
});

// INV: pulls the customer's current subscription from Stripe; covers a delayed or missed webhook after checkout
const sync = route({ auth: true, rate: { key: "billing-sync", cap: 12, perMin: 6 } }, async (c) => {
  const customer = c.user.stripe_customer_id;
  if (!customer) return json(formatBilling(c.user));
  const sub = await findCustomerSubscription(customer);
  const row = sub ? await saveUserSubscription(c.user.id, customer, sub) : null;
  return json(formatBilling(row ?? c.user));
});

// INV: cancel and resume only touch a subscription that still grants pro; a fully canceled one needs a new checkout
const cancel = route({ auth: true, pro: true, rate: { key: "cancel", cap: 10, perMin: 10 } }, async (c) => setCancel(c.user, true));

const resume = route({ auth: true, pro: true, rate: { key: "resume", cap: 10, perMin: 10 } }, async (c) => setCancel(c.user, false));

// SEC: no session or Origin check; authenticity comes from the Stripe signature only
// INV: order-independent; state comes from a fresh fetch, the payload contributes only event id and subscription id
const webhook = route({ csrf: false, maxBody: WEBHOOK_MAX, rate: { key: "stripe-webhook", cap: 120, perMin: 120 } }, async (c) => {
  const sig = c.req.headers.get("stripe-signature");
  const rawBody = await readBodyCapped(c.req, WEBHOOK_MAX);
  const body = new TextDecoder().decode(rawBody);
  if (!sig) throw new HttpError(400, "bad_request");
  let event: Stripe.Event;
  try {
    event = await Stripe.webhooks.constructEventAsync(body, sig, env.STRIPE_WEBHOOK_SECRET, undefined, cryptoProvider);
  } catch {
    throw new HttpError(400, "bad_request");
  }
  const subId = event.type.startsWith("customer.subscription.") && event.data.object.object === "subscription" ? event.data.object.id : null;
  await applyStripeEvent(event.id, subId, fetchSubscription);
  return json({ received: true });
});

export const billingRoutes = {
  "/api/billing": { GET: billing },
  "/api/billing/checkout": { POST: checkout },
  "/api/billing/portal": { POST: portal },
  "/api/billing/sync": { POST: sync },
  "/api/billing/cancel": { POST: cancel },
  "/api/billing/resume": { POST: resume },
  "/api/stripe/webhook": { POST: webhook },
};
