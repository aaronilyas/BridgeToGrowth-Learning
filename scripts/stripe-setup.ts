import { Stripe } from "stripe";
import { env } from "../src/server/env.ts";

// usage: bun [--env-file=/etc/btg/btg.env] scripts/stripe-setup.ts [https://your-host]
// Creates or reuses the Pro product, a monthly USD price of PRO_PRICE_USD (lookup key btg_pro_monthly) and the webhook endpoint.
// STRIPE_PRICE_ID and STRIPE_WEBHOOK_SECRET may hold placeholders (price_…, whsec_…) on the first run.

const LOOKUP_KEY = "btg_pro_monthly";
const EVENTS: Stripe.WebhookEndpointCreateParams.EnabledEvent[] = ["customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted"];

const stripe = new Stripe(env.STRIPE_SECRET_KEY);

// O(1) network calls
// INV: an existing price with the same amount is reused; a changed amount gets a new price that takes over the lookup key
async function ensurePrice(cents: number): Promise<string> {
  const found = await stripe.prices.list({ lookup_keys: [LOOKUP_KEY], active: true, limit: 1 });
  const cur = found.data[0];
  if (cur && cur.unit_amount === cents && cur.currency === "usd" && cur.recurring?.interval === "month") return cur.id;
  const product = cur ? (typeof cur.product === "string" ? cur.product : cur.product.id) : (await stripe.products.create({ name: "BridgeToGrowth Pro", description: "Pro plan: higher monthly AI usage, settings, personal stats, lessons kept for good." })).id;
  const price = await stripe.prices.create({ product, currency: "usd", unit_amount: cents, recurring: { interval: "month" }, lookup_key: LOOKUP_KEY, transfer_lookup_key: true });
  if (cur) await stripe.prices.update(cur.id, { active: false });
  return price.id;
}

// O(endpoints) network calls
// INV: Stripe shows a signing secret only when the endpoint is created; an existing endpoint just gets its events updated
async function ensureWebhook(origin: string): Promise<{ id: string; secret: string | null }> {
  const url = `${origin}/api/stripe/webhook`;
  const list = await stripe.webhookEndpoints.list({ limit: 100 });
  const existing = list.data.find((w) => w.url === url);
  if (existing) {
    await stripe.webhookEndpoints.update(existing.id, { enabled_events: EVENTS, disabled: false });
    return { id: existing.id, secret: null };
  }
  const created = await stripe.webhookEndpoints.create({ url, enabled_events: EVENTS, description: "BridgeToGrowth Learning subscriptions" });
  return { id: created.id, secret: created.secret ?? null };
}

// O(1)
// SEC: prints only the price id and the new webhook signing secret, never STRIPE_SECRET_KEY
async function runSetup(): Promise<number> {
  const origin = (process.argv[2] ?? env.APP_ORIGIN).replace(/\/+$/, "");
  const mode = env.STRIPE_SECRET_KEY.includes("_live_") ? "live" : "test";
  try {
    const priceId = await ensurePrice(Math.round(env.PRO_PRICE_USD * 100));
    console.log(`Stripe ${mode} mode`);
    console.log(`STRIPE_PRICE_ID=${priceId}`);
    if (!origin.startsWith("https://")) {
      console.log(`Skipped the webhook: ${origin} is not https. For local testing run: stripe listen --forward-to localhost:${env.PORT}/api/stripe/webhook`);
      return 0;
    }
    const hook = await ensureWebhook(origin);
    if (hook.secret) console.log(`STRIPE_WEBHOOK_SECRET=${hook.secret}`);
    else console.log(`Webhook ${hook.id} already exists and was updated. Its signing secret is under Developers → Webhooks in the dashboard.`);
    console.log("Put these values in your env file, then restart the app.");
    return 0;
  } catch (e) {
    console.error(`stripe setup failed: ${e instanceof Stripe.errors.StripeError ? `${e.type}: ${e.message}` : "unknown error"}`);
    return 1;
  }
}

process.exit(await runSetup());
