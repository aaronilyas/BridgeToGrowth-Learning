# P04 · Billing: Stripe subscription, free trial, entitlement

GOAL: Users on the free trial or with an active subscription are entitled. Stripe Checkout, the Portal and cancel/resume work. The webhook syncs state regardless of event order, and `route()` gains `entitled`.

GIVEN: P03 (`ctx.user` carries the `sub_*` and `trial_ends_at` columns).

DELIVER: `src/server/billing/{core.ts,sql.ts,routes.ts,stripe.ts}`, schemas in `src/shared/api.ts`, `/api/me` extended with `entitlement`.

CONTRACT:
```ts
type Plan = "pro" | "trial" | "none";
// O(1)  INV: pure; the only source of truth for access
export function entitlementOf(u: {sub_status: string; trial_ends_at: Date}, now: Date): { plan: Plan; capMicros: bigint };
//   pro   if sub_status ∈ {active, trialing, past_due}   capMicros = PRO_CAP_USD*1e6
//   trial if now < trial_ends_at                          capMicros = TRIAL_CAP_USD*1e6
//   none  otherwise                                       capMicros = 0
```
```
GET  /api/billing          (auth) → {plan, subStatus, periodEnd|null, cancelAtPeriodEnd, trialEndsAt}
POST /api/billing/checkout (auth) → {url}  | 409 already_subscribed if plan=pro
POST /api/billing/portal   (auth) → {url}  (requires stripe_customer_id, else 404)
POST /api/billing/cancel   (auth) → billing state; Stripe sub cancel_at_period_end=true; DB updated immediately
POST /api/billing/resume   (auth) → billing state; cancel_at_period_end=false
POST /api/stripe/webhook   (csrf:false, no auth, maxBody 1 MiB) → 200 | 400
RouteOpts.entitled?: true  → requires auth; plan none → 402 payment_required; sets ctx.plan, ctx.capMicros
```
- `stripe.ts` is the only place that constructs `new Stripe(env.STRIPE_SECRET_KEY)`, with the SDK's default pinned `apiVersion`.
- Customer creation uses idempotency key `cust-${uid}` and then `UPDATE users SET stripe_customer_id=$c WHERE id=$uid AND stripe_customer_id IS NULL`. If that updates 0 rows, re-read the existing ID and use it.
- Checkout: `mode: subscription`, one line item `STRIPE_PRICE_ID`, `customer`, `client_reference_id: uid`, `success_url: ${APP_ORIGIN}/billing?ok=1`, `cancel_url: ${APP_ORIGIN}/billing`.
- Webhook flow:
  1. Read the raw body with `req.text()`.
  2. Verify it with `stripe.webhooks.constructEventAsync(body, sig, secret, undefined, Stripe.createSubtleCryptoProvider())`. Failure returns 400 with no DB write.
  3. In one transaction, `INSERT INTO stripe_events … ON CONFLICT DO NOTHING RETURNING id`. If no row comes back, return 200 (replay no-op).
  4. For `customer.subscription.*`, call `stripe.subscriptions.retrieve(id)`. The fetched object is authoritative (`// INV: order-independent`). Update the user `WHERE stripe_customer_id = sub.customer`, setting `sub_id`, `sub_status`, `sub_cancel_at_period_end` and `sub_period_end`. Read `sub_period_end` from `items.data[0].current_period_end` on API ≥ 2025-03-31, or from the top-level field on older versions.
  5. Any other event type, or an unknown customer, returns 200.

INV:
- Entitlement is decided on the server only, per request, from the row loaded with the session (no extra query).
- The webhook never trusts payload fields for state. It only uses `sub.id` and `customer` to fetch and match.
- Stripe error messages are never forwarded to the client; they map to 502 `upstream`.

TESTS (max 3; `stripe.ts` mocked with `mock.module`, signatures built with `stripe.webhooks.generateTestHeaderString`):
1. `entitlementOf` truth table: one table-driven test covering active, past_due, canceled with trial live, canceled with trial expired, none with trial live, and none with trial expired.
2. A bad signature returns 400, and the `stripe_events` row count is unchanged.
3. Delivering a valid `customer.subscription.updated` twice updates the user once (the mocked retrieve is called once), and the second delivery returns 200.

VERIFY: `bun test`. Then, with test keys: run `stripe listen --forward-to 127.0.0.1:3000/api/stripe/webhook`, check out with card 4242…, confirm `/api/billing` shows plan `pro`, cancel, and confirm `cancelAtPeriodEnd: true`.

NO: multiple prices or plans, coupons, invoices UI, metered billing.
