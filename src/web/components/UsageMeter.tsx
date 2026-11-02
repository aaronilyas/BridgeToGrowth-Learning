import { useEffect, useState, type JSX } from "react";
import { Link, useLocation } from "wouter";
import { UsageResponse } from "../../shared/api.ts";
import { api } from "../api.ts";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

// O(n) in the month's model rows
export function spentUsd(rows: readonly { costUsd: number | null }[]): number | null {
  if (rows.length > 0 && rows.every((row) => row.costUsd === null)) return null;
  return rows.reduce((sum, row) => sum + (row.costUsd ?? 0), 0);
}

// O(1)
export function UsageMeter({ spent }: { spent: number | null }): JSX.Element {
  const label = spent === null ? "Recorded" : money.format(spent);
  return (
    <div className="rounded-2xl border border-border bg-panel p-5">
      <h2 className="text-lg font-semibold">Monthly usage</h2>
      <p className="mt-2 text-sm text-muted">{label} used</p>
    </div>
  );
}

// O(1)
export function UsageCard(): JSX.Element | null {
  const [location] = useLocation();
  const [usage, setUsage] = useState<UsageResponse | null>(null);
  useEffect(() => {
    let live = true;
    api("/api/usage", UsageResponse).then((row) => live && setUsage(row), () => undefined);
    return () => {
      live = false;
    };
  }, [location]);
  if (!usage) return null;
  const spent = spentUsd(usage.current);
  const label = spent === null ? "Recorded this month" : `${money.format(spent)} used this month`;
  return (
    <Link href="/usage" className="block rounded-xl border border-border bg-panel-2 p-4 transition hover:border-accent/40">
      <p className="text-sm text-muted">AI usage</p>
      <p className="mt-2 text-xs text-muted">{label}</p>
    </Link>
  );
}
