import { sql } from "../db.ts";
import { bigFrom } from "../sqlmap.ts";

export type UsageInsert = { provider: string; model: string; kind: string; inputTokens: number; outputTokens: number; costMicros: bigint | null };
export type UsageGroup = { period: string; provider: string; model: string; inputTokens: number; outputTokens: number; costMicros: bigint | null };

// O(1)
export async function insertLlmUsage(row: UsageInsert): Promise<void> {
  await sql`
    INSERT INTO llm_usage (provider, model, kind, input_tokens, output_tokens, cost_micros)
    VALUES (${row.provider}, ${row.model}, ${row.kind}, ${row.inputTokens}, ${row.outputTokens}, ${row.costMicros})`;
}

// O(1)
export async function openRouterMonthMicros(startMs: number, endMs: number): Promise<bigint> {
  const rows: { cost: unknown }[] = await sql`
    SELECT coalesce(sum(cost_micros), 0) AS cost FROM llm_usage
    WHERE provider = 'openrouter' AND created_at >= ${startMs} AND created_at < ${endMs} LIMIT 1`;
  return bigFrom(rows[0]?.cost);
}

// O(n) in grouped rows, bounded by LIMIT
export async function listUsageGroups(sinceMs: number): Promise<UsageGroup[]> {
  const rows: { period: string; provider: string; model: string; input_tokens: unknown; output_tokens: unknown; cost_micros: unknown; missing_cost: number }[] = await sql`
    SELECT strftime('%Y-%m', created_at / 1000, 'unixepoch') AS period, provider, model,
      sum(input_tokens) AS input_tokens, sum(output_tokens) AS output_tokens,
      sum(cost_micros) AS cost_micros, sum(CASE WHEN cost_micros IS NULL THEN 1 ELSE 0 END) AS missing_cost
    FROM llm_usage WHERE created_at >= ${sinceMs}
    GROUP BY period, provider, model ORDER BY period DESC, provider, model LIMIT 2000`;
  return rows.map((row) => ({
    period: row.period,
    provider: row.provider,
    model: row.model,
    inputTokens: Number(bigFrom(row.input_tokens)),
    outputTokens: Number(bigFrom(row.output_tokens)),
    costMicros: row.missing_cost > 0 || row.cost_micros === null ? null : bigFrom(row.cost_micros),
  }));
}
