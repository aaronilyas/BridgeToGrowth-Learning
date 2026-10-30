import { useState, type JSX } from "react";
import { fmtPct } from "./StatTile.tsx";

export type DailyPoint = { day: string; attempts: number; accuracy: number | null };

const W = 640;
const H = 240;
const M = { l: 44, r: 56, t: 16, b: 40 };

// O(n)
// INV: bars are attempts (left axis), the line is accuracy 0–100% (right axis); null accuracy breaks the line
export function LineChart({ data }: { data: DailyPoint[] }): JSX.Element {
  const [hover, setHover] = useState<number | null>(null);
  const n = data.length;
  const max = Math.max(5, ...data.map((d) => d.attempts));
  const iw = W - M.l - M.r;
  const ih = H - M.t - M.b;
  const step = n === 0 ? iw : iw / n;
  const cx = (i: number): number => M.l + step * (i + 0.5);
  const yA = (v: number): number => M.t + ih - (v / max) * ih;
  const yP = (v: number): number => M.t + ih - v * ih;
  let path = "";
  let pen = false;
  data.forEach((d, i) => {
    if (d.accuracy === null) pen = false;
    else {
      path += `${pen ? "L" : "M"}${cx(i).toFixed(1)} ${yP(d.accuracy).toFixed(1)}`;
      pen = true;
    }
  });
  const total = data.reduce((a, d) => a + d.attempts, 0);
  const labelEvery = Math.max(1, Math.ceil(n / 8));
  const h = hover === null ? undefined : data[hover];
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`Daily attempts (bars) and accuracy (line) over ${n} days, ${total} attempts in total`} onMouseLeave={() => setHover(null)}>
        {[0, 0.5, 1].map((t) => (
          <g key={t}>
            <line x1={M.l} x2={W - M.r} y1={yP(t)} y2={yP(t)} stroke="var(--border)" strokeDasharray="3 3" />
            <text x={W - M.r + 6} y={yP(t) + 4} fontSize={11} fill="var(--muted)">{Math.round(t * 100)}%</text>
            <text x={M.l - 6} y={yP(t) + 4} fontSize={11} textAnchor="end" fill="var(--muted)">{Math.round(t * max)}</text>
          </g>
        ))}
        {data.map((d, i) => (
          <rect key={d.day} x={cx(i) - Math.min(12, Math.max(1, step * 0.35))} width={Math.min(24, Math.max(2, step * 0.7))} y={yA(d.attempts)} height={M.t + ih - yA(d.attempts)} rx={2} fill="var(--accent)" fillOpacity={hover === i ? 0.6 : 0.3} />
        ))}
        <path d={path} fill="none" stroke="var(--accent-2)" strokeWidth={2} strokeLinejoin="round" />
        {data.map((d, i) => d.accuracy !== null && <circle key={d.day} cx={cx(i)} cy={yP(d.accuracy)} r={hover === i ? 4.5 : 2.5} fill="var(--accent-2)" />)}
        {data.map((d, i) => i % labelEvery === 0 && <text key={d.day} x={cx(i)} y={H - 20} fontSize={11} textAnchor="middle" fill="var(--muted)">{d.day.slice(5)}</text>)}
        <text x={M.l - 34} y={M.t - 4} fontSize={11} fill="var(--muted)">Attempts</text>
        <text x={W - M.r + 6} y={M.t - 4} fontSize={11} fill="var(--muted)">Accuracy</text>
        <text x={M.l + iw / 2} y={H - 4} fontSize={11} textAnchor="middle" fill="var(--muted)">Day (UTC)</text>
        {data.map((d, i) => <rect key={d.day} x={M.l + step * i} y={M.t} width={step} height={ih} fill="transparent" onMouseEnter={() => setHover(i)} />)}
      </svg>
      {h && hover !== null && (
        <div className="pointer-events-none absolute top-2 rounded-lg border border-border bg-panel-2 px-3 py-2 text-xs text-text shadow" style={{ left: `${Math.min(80, Math.max(2, (cx(hover) / W) * 100))}%` }}>
          <p className="font-semibold">{h.day}</p>
          <p className="text-muted">Attempts: {h.attempts}</p>
          <p className="text-muted">Accuracy: {fmtPct(h.accuracy)}</p>
        </div>
      )}
    </div>
  );
}
