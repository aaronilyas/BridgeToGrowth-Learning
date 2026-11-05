import { useEffect, useState, type JSX } from "react";
import { Link, useLocation } from "wouter";
import { UsageResponse } from "../../shared/api.ts";
import { api } from "../api.ts";
import { useSettings } from "../session.tsx";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

// O(n)
// INV: null costs are skipped; an empty known set returns null rather than a guessed zero
export function summarizeReportedCost(rows: readonly { costUsd: number | null }[]): { amount: number | null; partial: boolean } {
  let amount = 0;
  let known = 0;
  for (const row of rows) {
    if (row.costUsd === null) continue;
    amount += row.costUsd;
    known += 1;
  }
  if (known === 0) return { amount: null, partial: false };
  return { amount, partial: known !== rows.length };
}

// O(n)
// INV: zero means OpenRouter has no rows; null means rows exist but none reported a cost
export function sumOpenRouterUsd(rows: readonly { provider: string; costUsd: number | null }[]): number | null {
  const own = rows.filter((row) => row.provider === "openrouter");
  if (own.length === 0) return 0;
  return summarizeReportedCost(own).amount;
}

// O(1)
export function UsageMeter({ spent, budget = null }: { spent: number | null; budget?: number | null }): JSX.Element {
  const headline = spent === null ? "No provider cost reported" : `${money.format(spent)} used`;
  const showBar = budget !== null && spent !== null;
  const pct = showBar && budget !== null && spent !== null ? Math.min(100, budget === 0 ? (spent > 0 ? 100 : 0) : Math.round((spent / budget) * 100)) : 0;
  return (
    <div className="rounded-xl border border-border bg-panel p-5">
      <h2 className="display text-lg">Monthly usage</h2>
      <p className="mt-2 text-sm text-muted">{headline}</p>
      {showBar && budget !== null && spent !== null && (
        <>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-border" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="OpenRouter budget">
            <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-2 text-xs text-muted">{money.format(spent)} of {money.format(budget)} · applies to OpenRouter only</p>
        </>
      )}
      {budget !== null && spent === null && <p className="mt-2 text-xs text-muted">OpenRouter budget is {money.format(budget)}. No cost has been reported yet.</p>}
    </div>
  );
}

// O(1)
function usageLine(spent: number | null, budget: number | null): string {
  if (spent === null) return "No cost reported";
  if (budget !== null) return `${money.format(spent)} / ${money.format(budget)}`;
  return `${money.format(spent)} this month`;
}

// O(1)
// INV: renders nothing until usage loads, so the sidebar footer never flashes a guessed value
export function UsageCard(): JSX.Element | null {
  const [location] = useLocation();
  const { settings } = useSettings();
  const [usage, setUsage] = useState<UsageResponse | null>(null);
  useEffect(() => {
    let live = true;
    api("/api/usage", UsageResponse).then((row) => live && setUsage(row), () => undefined);
    return () => {
      live = false;
    };
  }, [location]);
  if (!usage) return null;
  return (
    <Link href="/usage" className="flex items-baseline justify-between gap-2 font-mono text-xs text-muted transition hover:text-text">
      <span className="label">AI usage</span>
      <span>{usageLine(sumOpenRouterUsd(usage.current), settings.budgetUsd)}</span>
    </Link>
  );
}
