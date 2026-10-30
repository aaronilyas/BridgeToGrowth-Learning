import { Stripe } from "stripe";
import type { AuthUser } from "../auth/core.ts";
import { env } from "../env.ts";
import { HttpError, json, route } from "../http.ts";
import { entitlementOf, formatBilling } from "./core.ts";
import { applyStripeEvent, claimCustomerId, saveUserSubscription } from "./sql.ts";
import { createCheckoutUrl, createPortalUrl, createStripeCustomer, fetchSubscription, setStripeCancelAtPeriodEnd } from "./stripe.ts";

const WEBHOOK_MAX = 2 ** 20;
const cryptoProvider = Stripe.createSubtleCryptoProvider();

async function ensureCustomer(u: AuthUser): Promise<string> {
  if (u.stripe_customer_id) return u.stripe_customer_id;
  return claimCustomerId(u.id, await createStripeCustomer(u.id, u.email));
}

async function setCancel(u: AuthUser, cancel: boolean): Promise<Response> {
  if (!u.sub_id) throw new HttpError(404, "not_found");
  const row = await saveUserSubscription(u.id, await setStripeCancelAtPeriodEnd(u.sub_id, cancel));
  if (!row) throw new HttpError(404, "not_found");
  return json(formatBilling(row, entitlementOf(row, new Date()).plan));
}

const billing = route({ auth: true }, async (c) => json(formatBilling(c.user, entitlementOf(c.user, new Date()).plan)));

const checkout = route({ auth: true, rate: { key: "checkout", cap: 10, perMin: 10 } }, async (c) => {
  if (entitlementOf(c.user, new Date()).plan === "pro") throw new HttpError(409, "already_subscribed");
  return json({ url: await createCheckoutUrl(await ensureCustomer(c.user), c.user.id) });
});

const portal = route({ auth: true, rate: { key: "portal", cap: 10, perMin: 10 } }, async (c) => {
  if (!c.user.stripe_customer_id) throw new HttpError(404, "not_found");
  return json({ url: await createPortalUrl(c.user.stripe_customer_id) });
});

const cancel = route({ auth: true, rate: { key: "cancel", cap: 10, perMin: 10 } }, async (c) => setCancel(c.user, true));

const resume = route({ auth: true, rate: { key: "resume", cap: 10, perMin: 10 } }, async (c) => setCancel(c.user, false));

// SEC: no session or Origin check; authenticity comes from the Stripe signature only
// INV: order-independent; state comes from a fresh fetch, the payload contributes only event id and subscription id
const webhook = route({ csrf: false, maxBody: WEBHOOK_MAX }, async (c) => {
  const sig = c.req.headers.get("stripe-signature");
  const body = await c.req.text();
  if (!sig || new TextEncoder().encode(body).length > WEBHOOK_MAX) throw new HttpError(400, "bad_request");
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
  "/api/billing/cancel": { POST: cancel },
  "/api/billing/resume": { POST: resume },
  "/api/stripe/webhook": { POST: webhook },
};
