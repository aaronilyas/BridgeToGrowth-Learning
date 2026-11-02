import { useEffect, useState, type JSX } from "react";
import { Link, useLocation } from "wouter";
import { UsageResponse } from "../../shared/api.ts";
import { api } from "../api.ts";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

// O(1)
function formatUsd(micros: number): string {
  return money.format(micros / 1e6);
}

// O(1)
export function UsageMeter({ usedMicros, reservedMicros }: { usedMicros: number; reservedMicros: number }): JSX.Element {
  return (
    <div className="rounded-2xl border border-border bg-panel p-5">
      <h2 className="text-lg font-semibold">Monthly usage</h2>
      <p className="mt-2 text-sm text-muted">{formatUsd(usedMicros)} used · {formatUsd(reservedMicros)} reserved</p>
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
  return (
    <Link href="/usage" className="block rounded-xl border border-border bg-panel-2 p-4 transition hover:border-accent/40">
      <p className="text-sm text-muted">AI usage</p>
      <p className="mt-2 text-xs text-muted">{formatUsd(usage.usedMicros)} used this month</p>
    </Link>
  );
}
