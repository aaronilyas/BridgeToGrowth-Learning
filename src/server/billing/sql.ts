import type { SQL } from "bun";
import { sql } from "../db.ts";
import { isProStatus, type BillingRow, type SubSnapshot } from "./core.ts";

const PRO_LIST = ["active", "trialing", "past_due"];

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

// O(log n) on the unique stripe_customer_id index
// INV: a non-pro snapshot of a different subscription never overwrites a pro one, so a stray duplicate checkout cannot cancel a paying user
// INV: becoming pro clears the free-plan expiry on the user's lessons in the same transaction
async function applySubscription(tx: SQL, s: SubSnapshot): Promise<BillingRow | null> {
  if (isProStatus(s.status)) {
    const current: { sub_id: string | null; sub_status: string }[] = await tx`
      SELECT sub_id, sub_status FROM users WHERE stripe_customer_id = ${s.customer} LIMIT 1`;
    if (current[0]?.sub_id && current[0].sub_id !== s.id && isProStatus(current[0].sub_status)) {
      console.error("billing: duplicate active subscription for customer");
    }
  }
  const rows: (BillingRow & { id: string })[] = await tx`
    UPDATE users SET sub_id = ${s.id}, sub_status = ${s.status}, sub_cancel_at_period_end = ${s.cancelAtPeriodEnd}, sub_period_end = ${s.periodEnd}
    WHERE stripe_customer_id = ${s.customer}
      AND NOT (${!isProStatus(s.status)}::boolean AND sub_id IS NOT NULL AND sub_id <> ${s.id} AND sub_status = ANY(${PRO_LIST}::text[]))
    RETURNING id, stripe_customer_id, sub_status, sub_period_end, sub_cancel_at_period_end`;
  const row = rows[0];
  if (!row) return null;
  if (isProStatus(s.status)) await tx`UPDATE lessons SET expires_at = NULL WHERE user_id = ${row.id} AND expires_at IS NOT NULL`;
  return { stripe_customer_id: row.stripe_customer_id, sub_status: row.sub_status, sub_period_end: row.sub_period_end, sub_cancel_at_period_end: row.sub_cancel_at_period_end };
}

// O(log n)
// SEC: the snapshot's customer must be the caller's stored customer, so a user can only ever write their own row
export async function saveUserSubscription(uid: string, customer: string, s: SubSnapshot): Promise<BillingRow | null> {
  if (s.customer !== customer) return null;
  return sql.begin(async (tx) => {
    const owned: { id: string }[] = await tx`SELECT id FROM users WHERE id = ${uid} AND stripe_customer_id = ${customer} FOR UPDATE`;
    if (owned.length === 0) return null;
    return applySubscription(tx, s);
  });
}

// O(log n) plus the fetch
// INV: event insert and user update commit together; a failed fetch rolls back so Stripe retries
// SEC: webhook has no session; the user is matched only by the Stripe-fetched customer id (unique index)
export async function applyStripeEvent(eventId: string, subId: string | null, fetchSub: (id: string) => Promise<SubSnapshot>): Promise<"replay" | "applied" | "ignored"> {
  return sql.begin(async (tx) => {
    const ins: { id: string }[] = await tx`INSERT INTO stripe_events (id) VALUES (${eventId}) ON CONFLICT DO NOTHING RETURNING id`;
    if (!ins[0]) return "replay";
    if (!subId) return "ignored";
    return (await applySubscription(tx, await fetchSub(subId))) ? "applied" : "ignored";
  });
}

// O(k) in pruned rows, via stripe_events_received_idx
// INV: Stripe retries for at most 3 days, so 30 days of event ids is enough to drop replays
export async function pruneStripeEvents(): Promise<void> {
  await sql`DELETE FROM stripe_events WHERE received_at < now() - interval '30 days'`;
}
