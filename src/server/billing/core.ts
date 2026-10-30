import type { Stripe } from "stripe";
import type { AuthUser } from "../auth/core.ts";
import type { BillingResponse, Plan } from "../../shared/api.ts";
import { env } from "../env.ts";

export type Entitlement = { plan: Plan; capMicros: bigint };
export type SubSnapshot = { id: string; customer: string; status: string; cancelAtPeriodEnd: boolean; periodEnd: Date | null };
export type BillingRow = Pick<AuthUser, "trial_ends_at" | "sub_status" | "sub_period_end" | "sub_cancel_at_period_end">;

const PRO_STATUSES = new Set(["active", "trialing", "past_due"]);
const DB_STATUSES = new Set(["none", "active", "trialing", "past_due", "canceled", "incomplete", "unpaid"]);

// O(1)
// INV: pure (env is immutable config); the only source of truth for access
export function entitlementOf(u: { sub_status: string; trial_ends_at: Date }, now: Date): Entitlement {
  if (PRO_STATUSES.has(u.sub_status)) return { plan: "pro", capMicros: toMicros(env.PRO_CAP_USD) };
  if (now < u.trial_ends_at) return { plan: "trial", capMicros: toMicros(env.TRIAL_CAP_USD) };
  return { plan: "none", capMicros: 0n };
}

// O(1)
function toMicros(usd: number): bigint {
  return BigInt(Math.round(usd * 1e6));
}

// O(1)
// INV: statuses outside the users.sub_status CHECK (incomplete_expired, paused, future values) collapse to canceled, which is never entitled
export function normalizeSubStatus(status: string): string {
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
export function formatBilling(row: BillingRow, plan: Plan): BillingResponse {
  return {
    plan,
    subStatus: row.sub_status,
    periodEnd: row.sub_period_end ? row.sub_period_end.toISOString() : null,
    cancelAtPeriodEnd: row.sub_cancel_at_period_end,
    trialEndsAt: row.trial_ends_at.toISOString(),
  };
}
