import { sql } from "../db.ts";
import { bigFrom, dateFromMs, dayStartMs } from "../sqlmap.ts";
import type { Usage } from "./core.ts";

export type UsageRow = { usedMicros: bigint; reservedMicros: bigint };
export type CallRow = { kind: string; model: string; promptTokens: number | null; completionTokens: number | null; costMicros: bigint; createdAt: Date };

// O(log n), one statement on the (user_id, period) primary key
// INV: the increment is one atomic upsert; there is no dollar cap
export async function reserveQuota(uid: string, period: string, est: bigint): Promise<void> {
  await sql`
    INSERT INTO usage_periods (user_id, period, reserved_micros) VALUES (${uid}, ${period}, ${est})
    ON CONFLICT (user_id, period) DO UPDATE SET reserved_micros = usage_periods.reserved_micros + ${est}`;
}

// O(log n), two statements in one transaction
// INV: releases the reservation, books the actual cost and logs the call atomically; SQLite has one writer
export async function settleQuota(uid: string, period: string, kind: string, model: string, est: bigint, u: Usage & { costMicros: bigint }): Promise<void> {
  await sql.begin(async (tx) => {
    await tx`
      UPDATE usage_periods SET reserved_micros = max(reserved_micros - ${est}, 0), used_micros = used_micros + ${u.costMicros}
      WHERE user_id = ${uid} AND period = ${period}`;
    await tx`
      INSERT INTO llm_calls (user_id, kind, model, prompt_tokens, completion_tokens, cost_micros)
      VALUES (${uid}, ${kind}, ${model}, ${u.promptTokens}, ${u.completionTokens}, ${u.costMicros})`;
  });
}

// O(n) in usage rows
// INV: single process means no in-flight reservations at boot
export async function resetReservations(): Promise<void> {
  await sql`UPDATE usage_periods SET reserved_micros = 0 WHERE reserved_micros <> 0`;
}

// O(log n)
export async function findUsage(uid: string, period: string): Promise<UsageRow> {
  const rows: { used_micros: unknown; reserved_micros: unknown }[] = await sql`
    SELECT used_micros, reserved_micros FROM usage_periods WHERE user_id = ${uid} AND period = ${period} LIMIT 1`;
  const r = rows[0];
  return { usedMicros: bigFrom(r?.used_micros), reservedMicros: bigFrom(r?.reserved_micros) };
}

// O(k log n) in the user's calls this period, via llm_calls_user_created_idx
export async function listCostByModel(uid: string, period: string): Promise<{ model: string; costMicros: bigint }[]> {
  const rows: { model: string; cost: unknown }[] = await sql`
    SELECT model, sum(cost_micros) AS cost FROM llm_calls
    WHERE user_id = ${uid} AND created_at >= ${dayStartMs(period)}
    GROUP BY model ORDER BY sum(cost_micros) DESC LIMIT 50`;
  return rows.map((r) => ({ model: r.model, costMicros: bigFrom(r.cost) }));
}

// O(log n), via llm_calls_user_created_idx
export async function listRecentCalls(uid: string): Promise<CallRow[]> {
  const rows: { kind: string; model: string; prompt_tokens: number | null; completion_tokens: number | null; cost_micros: unknown; created_at: number }[] = await sql`
    SELECT kind, model, prompt_tokens, completion_tokens, cost_micros, created_at FROM llm_calls
    WHERE user_id = ${uid} ORDER BY created_at DESC LIMIT 20`;
  return rows.map((r) => ({ kind: r.kind, model: r.model, promptTokens: r.prompt_tokens, completionTokens: r.completion_tokens, costMicros: bigFrom(r.cost_micros), createdAt: dateFromMs(r.created_at) }));
}
