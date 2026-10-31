import { useEffect, useState, type JSX } from "react";
import { Link, useLocation } from "wouter";
import { UsageResponse, type Plan } from "../../shared/api.ts";
import { api } from "../api.ts";
import { formatMicros } from "../money.ts";
import { Panel } from "./Panel.tsx";

// O(1)
// INV: the percent is used plus reserved over the plan cap; a cap of 0 is 100% once any usage exists
export function usagePercent(usedMicros: number, reservedMicros: number, capMicros: number): number {
  const consumed = usedMicros + reservedMicros;
  if (capMicros <= 0) return consumed > 0 ? 100 : 0;
  return Math.round((consumed / capMicros) * 100);
}

// O(1)
function usageFill(usedMicros: number, capMicros: number): number {
  if (capMicros <= 0) return usedMicros > 0 ? 100 : 0;
  return Math.min(100, (usedMicros / capMicros) * 100);
}

// O(1)
function usageTone(pct: number): string {
  return pct >= 100 ? "bg-danger" : pct >= 80 ? "bg-accent-2" : "bg-accent";
}

// O(1)
function usageTextTone(pct: number): string {
  return pct >= 100 ? "text-danger" : pct >= 80 ? "text-accent-2" : "text-accent";
}

// O(1)
function planName(plan: Plan): string {
  return plan === "pro" ? "Pro" : "Free";
}

// O(1)
function UsageBar({ usedMicros, reservedMicros, capMicros, label }: { usedMicros: number; reservedMicros: number; capMicros: number; label: string }): JSX.Element {
  const pct = usagePercent(usedMicros, reservedMicros, capMicros);
  const usedWidth = usageFill(usedMicros, capMicros);
  const reservedWidth = Math.min(100 - usedWidth, usageFill(reservedMicros, capMicros));
  return (
    <div className="flex items-center gap-2">
      <div
        className="flex h-3 min-w-0 flex-1 overflow-hidden rounded-full bg-panel-2"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.min(100, pct)}
        aria-valuetext={`${pct}%`}
        aria-label={label}
      >
        <div className={`h-full ${usageTone(pct)}`} style={{ width: `${usedWidth}%` }} />
        <div className="h-full border-x border-dashed border-text/50" style={{ width: `${reservedWidth}%`, backgroundImage: "repeating-linear-gradient(135deg, var(--accent-soft) 0 4px, transparent 4px 8px)" }} />
      </div>
      <span className={`w-12 shrink-0 text-right text-sm font-semibold tabular-nums ${usageTextTone(pct)}`}>{pct}%</span>
    </div>
  );
}

// O(1)
export function UsageMeter({ usedMicros, reservedMicros, capMicros, plan }: { usedMicros: number; reservedMicros: number; capMicros: number; plan: Plan }): JSX.Element {
  const pct = usagePercent(usedMicros, reservedMicros, capMicros);
  return (
    <Panel>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-semibold">Monthly usage · {planName(plan)}</h2>
        <span className="text-sm text-muted">{formatMicros(usedMicros)} used of {formatMicros(capMicros)}</span>
      </div>
      <div className="mt-4">
        <UsageBar usedMicros={usedMicros} reservedMicros={reservedMicros} capMicros={capMicros} label={`${planName(plan)} monthly AI usage`} />
      </div>
      {capMicros <= 0 ? (
        <p className="mt-2 text-sm text-muted">Your plan has no AI allowance this month.</p>
      ) : (
        <p className="mt-2 text-sm text-muted">{formatMicros(reservedMicros)} reserved · {pct}% of this month's cap</p>
      )}
    </Panel>
  );
}

// O(1)
// INV: both plans share this card; the cap comes from /api/usage, which already applies the plan
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
  const pct = usagePercent(usage.usedMicros, usage.reservedMicros, usage.capMicros);
  return (
    <Link href="/usage" className="block rounded-xl border border-border bg-panel-2 p-4 transition hover:border-accent/40">
      <p className="text-sm text-muted">{planName(usage.plan)} AI usage</p>
      <div className="mt-2">
        <UsageBar usedMicros={usage.usedMicros} reservedMicros={usage.reservedMicros} capMicros={usage.capMicros} label={`${planName(usage.plan)} monthly AI usage, ${pct}%`} />
      </div>
      <p className="mt-2 text-xs text-muted">{formatMicros(usage.usedMicros)} of {formatMicros(usage.capMicros)}</p>
    </Link>
  );
}
