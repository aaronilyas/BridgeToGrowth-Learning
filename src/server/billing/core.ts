import type { Stripe } from "stripe";
import type { BillingResponse, Plan, PlanTerms } from "../../shared/api.ts";
import type { AuthUser } from "../auth/core.ts";
import { env } from "../env.ts";

export type Entitlement = { plan: Plan; capMicros: bigint };
export type SubSnapshot = { id: string; customer: string; status: string; cancelAtPeriodEnd: boolean; periodEnd: Date | null };
export type BillingRow = Pick<AuthUser, "stripe_customer_id" | "sub_status" | "sub_period_end" | "sub_cancel_at_period_end">;

const DAY_MS = 86_400_000;
const PRO_STATUSES: ReadonlySet<string> = new Set(["active", "trialing", "past_due"]);
const DB_STATUSES: ReadonlySet<string> = new Set(["none", "active", "trialing", "past_due", "canceled", "incomplete", "unpaid"]);

// O(1)
function toMicros(usd: number): bigint {
  return BigInt(Math.round(usd * 1e6));
}

// O(1)
// INV: pure (env is immutable config); the only source of truth for access. Every account is at least free; past_due stays pro while Stripe retries the card
export function entitlementOf(u: { sub_status: string }): Entitlement {
  if (PRO_STATUSES.has(u.sub_status)) return { plan: "pro", capMicros: toMicros(env.PRO_CAP_USD) };
  return { plan: "free", capMicros: toMicros(env.FREE_CAP_USD) };
}

// O(1)
export function isProStatus(status: string): boolean {
  return PRO_STATUSES.has(status);
}

// O(1)
export function readPlanTerms(): PlanTerms {
  return {
    free: { capMicros: Number(toMicros(env.FREE_CAP_USD)), lessonTtlDays: env.FREE_LESSON_TTL_DAYS },
    pro: { capMicros: Number(toMicros(env.PRO_CAP_USD)), priceCents: Math.round(env.PRO_PRICE_USD * 100) },
  };
}

// O(1)
// INV: lessons made on the free plan expire after FREE_LESSON_TTL_DAYS; pro lessons never expire
export function computeLessonExpiry(plan: Plan, now: Date): Date | null {
  return plan === "free" ? new Date(now.getTime() + env.FREE_LESSON_TTL_DAYS * DAY_MS) : null;
}

// O(1)
// INV: statuses outside the users.sub_status CHECK (incomplete_expired, paused, future values) collapse to canceled, which is never pro
function normalizeSubStatus(status: string): string {
  return DB_STATUSES.has(status) ? status : "canceled";
}

// O(k) in subscription items
// INV: API >= 2025-03-31 moved current_period_end onto subscription items
export function snapshotSubscription(sub: Stripe.Subscription): SubSnapshot {
  const customer = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const end = sub.items.data[0]?.current_period_end;
  return { id: sub.id, customer, status: normalizeSubStatus(sub.status), cancelAtPeriodEnd: sub.cancel_at_period_end, periodEnd: end === undefined ? null : new Date(end * 1000) };
}

// O(1)
export function formatBilling(row: BillingRow): BillingResponse {
  return {
    plan: entitlementOf(row).plan,
    subStatus: row.sub_status,
    periodEnd: row.sub_period_end ? row.sub_period_end.toISOString() : null,
    cancelAtPeriodEnd: row.sub_cancel_at_period_end,
    hasCustomer: row.stripe_customer_id !== null,
  };
}
