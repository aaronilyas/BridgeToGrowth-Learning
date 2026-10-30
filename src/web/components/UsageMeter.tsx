import type { JSX } from "react";
import { Panel } from "./Panel.tsx";

const money = new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" });
function formatUsageAmount(micros: number): string { return money.format(micros / 1e6); }

// O(1)
export function UsageMeter({ usedMicros, reservedMicros, capMicros }: { usedMicros: number; reservedMicros: number; capMicros: number }): JSX.Element {
  if (capMicros <= 0) {
    return (
      <Panel>
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-lg font-semibold">Monthly usage</h2>
          <span className="text-sm text-muted">Not billed</span>
        </div>
        <p className="mt-3 text-sm text-muted">{formatUsageAmount(usedMicros)} recorded. Calls are not billed.</p>
      </Panel>
    );
  }
  const pct = (usedMicros + reservedMicros) / capMicros * 100;
  const color = pct >= 100 ? "bg-danger" : pct >= 80 ? "bg-accent-2" : "bg-accent";
  const usedWidth = Math.min(100, capMicros > 0 ? usedMicros / capMicros * 100 : 100);
  const reservedWidth = Math.min(100 - usedWidth, capMicros > 0 ? reservedMicros / capMicros * 100 : 0);
  return <Panel><div className="flex items-baseline justify-between gap-3"><h2 className="text-lg font-semibold">Monthly usage</h2><span className="text-sm text-muted">{formatUsageAmount(usedMicros)} used of {formatUsageAmount(capMicros)}</span></div><div className="mt-4 flex h-3 overflow-hidden rounded-full bg-panel-2" role="meter" aria-valuemin={0} aria-valuemax={capMicros} aria-valuenow={usedMicros + reservedMicros} aria-label="Monthly AI usage"><div className={color} style={{ width: `${usedWidth}%` }} /><div className="border-x border-dashed border-text/50" style={{ width: `${reservedWidth}%`, backgroundImage: "repeating-linear-gradient(135deg, var(--accent-soft) 0 4px, transparent 4px 8px)" }} /></div><p className="mt-2 text-sm text-muted">{formatUsageAmount(reservedMicros)} reserved</p></Panel>;
}
