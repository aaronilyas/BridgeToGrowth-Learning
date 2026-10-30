import { useState, type JSX } from "react";
import { fmtPct } from "./StatTile.tsx";

export type BarGroup = { label: string; accuracy: number | null; retention: number | null };

const W = 640;
const H = 240;
const M = { l: 44, r: 12, t: 16, b: 50 };

// O(n)
// INV: both series are shares in [0,1]; null renders no bar and "—" in the tooltip
export function BarChart({ data }: { data: BarGroup[] }): JSX.Element {
  const [hover, setHover] = useState<number | null>(null);
  const n = data.length;
  const iw = W - M.l - M.r;
  const ih = H - M.t - M.b;
  const step = n === 0 ? iw : iw / n;
  const bw = Math.min(26, step * 0.32);
  const y = (v: number): number => M.t + ih - v * ih;
  const h = hover === null ? undefined : data[hover];
  const summary = data.map((d) => `${d.label} accuracy ${fmtPct(d.accuracy)}, retention ${fmtPct(d.retention)}`).join("; ");
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`Accuracy and retention per domain. ${summary || "No data"}`} onMouseLeave={() => setHover(null)}>
        {[0, 0.5, 1].map((t) => (
          <g key={t}>
            <line x1={M.l} x2={W - M.r} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeDasharray="3 3" />
            <text x={M.l - 6} y={y(t) + 4} fontSize={11} textAnchor="end" fill="var(--muted)">{Math.round(t * 100)}%</text>
          </g>
        ))}
        {data.map((d, i) => {
          const c = M.l + step * (i + 0.5);
          return (
            <g key={d.label} onMouseEnter={() => setHover(i)}>
              <rect x={M.l + step * i} y={M.t} width={step} height={ih} fill="transparent" />
              {d.accuracy !== null && <rect x={c - bw - 1} width={bw} y={y(d.accuracy)} height={M.t + ih - y(d.accuracy)} rx={3} fill="var(--accent)" fillOpacity={hover === i ? 1 : 0.8} />}
              {d.retention !== null && <rect x={c + 1} width={bw} y={y(d.retention)} height={M.t + ih - y(d.retention)} rx={3} fill="var(--accent-2)" fillOpacity={hover === i ? 1 : 0.8} />}
              <text x={c} y={H - 30} fontSize={11} textAnchor="middle" fill="var(--muted)">{d.label.length > 11 ? `${d.label.slice(0, 10)}…` : d.label}</text>
            </g>
          );
        })}
        <text x={M.l + iw / 2} y={H - 6} fontSize={11} textAnchor="middle" fill="var(--muted)">Domain</text>
      </svg>
      <div className="mt-1 flex gap-4 text-xs text-muted">
        <span className="flex items-center gap-1"><i className="inline-block h-2.5 w-2.5 rounded-sm bg-accent" />Accuracy</span>
        <span className="flex items-center gap-1"><i className="inline-block h-2.5 w-2.5 rounded-sm bg-accent-2" />Retention</span>
      </div>
      {h && (
        <div className="pointer-events-none absolute top-2 right-2 rounded-lg border border-border bg-panel-2 px-3 py-2 text-xs shadow">
          <p className="font-semibold text-text">{h.label}</p>
          <p className="text-muted">Accuracy: {fmtPct(h.accuracy)}</p>
          <p className="text-muted">Retention: {fmtPct(h.retention)}</p>
        </div>
      )}
    </div>
  );
}
