import { sql } from "../db.ts";
import type { BillingRow, SubSnapshot } from "./core.ts";

// O(log n)
// INV: first writer wins; a losing racer re-reads the stored id
export async function claimCustomerId(uid: string, customer: string): Promise<string> {
  const rows: { stripe_customer_id: string }[] = await sql`
    UPDATE users SET stripe_customer_id = ${customer}
    WHERE id = ${uid} AND stripe_customer_id IS NULL
    RETURNING stripe_customer_id`;
  if (rows[0]) return rows[0].stripe_customer_id;
  const existing: { stripe_customer_id: string | null }[] = await sql`SELECT stripe_customer_id FROM users WHERE id = ${uid} LIMIT 1`;
  return existing[0]?.stripe_customer_id ?? customer;
}

// O(log n)
export async function saveUserSubscription(uid: string, s: SubSnapshot): Promise<BillingRow | null> {
  const rows: BillingRow[] = await sql`
    UPDATE users SET sub_id = ${s.id}, sub_status = ${s.status}, sub_cancel_at_period_end = ${s.cancelAtPeriodEnd}, sub_period_end = ${s.periodEnd}
    WHERE id = ${uid} AND stripe_customer_id = ${s.customer}
    RETURNING trial_ends_at, sub_status, sub_period_end, sub_cancel_at_period_end`;
  return rows[0] ?? null;
}

// O(log n) plus the fetch
// INV: event insert and user update commit together; a failed fetch rolls back so Stripe retries
// SEC: webhook has no session; the user is matched only by the Stripe-fetched customer id (unique index)
export async function applyStripeEvent(eventId: string, subId: string | null, fetchSub: (id: string) => Promise<SubSnapshot>): Promise<"replay" | "applied" | "ignored"> {
  return sql.begin(async (tx) => {
    const ins: { id: string }[] = await tx`INSERT INTO stripe_events (id) VALUES (${eventId}) ON CONFLICT DO NOTHING RETURNING id`;
    if (!ins[0]) return "replay";
    if (!subId) return "ignored";
    const s = await fetchSub(subId);
    const upd = await tx`
      UPDATE users SET sub_id = ${s.id}, sub_status = ${s.status}, sub_cancel_at_period_end = ${s.cancelAtPeriodEnd}, sub_period_end = ${s.periodEnd}
      WHERE stripe_customer_id = ${s.customer}`;
    return upd.count > 0 ? "applied" : "ignored";
  });
}
