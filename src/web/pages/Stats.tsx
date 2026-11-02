import { useEffect, useMemo, useState, type JSX } from "react";
import { InsightsResponse, StatsResponse } from "../../shared/api.ts";
import { api } from "../api.ts";
import { BarChart } from "../charts/BarChart.tsx";
import { LineChart, type DailyPoint } from "../charts/LineChart.tsx";
import { StatTile, fmtPct } from "../charts/StatTile.tsx";
import { ErrorBanner } from "../components/ErrorBanner.tsx";
import { Panel } from "../components/Panel.tsx";
import { Spinner } from "../components/Spinner.tsx";

type Row = StatsResponse["byTopic"][number];
type SortKey = "name" | "domain" | "attempts" | "accuracy" | "retention" | "calibrationError" | "masteredShare";

const COLS: { key: SortKey; label: string }[] = [
  { key: "name", label: "Topic" },
  { key: "domain", label: "Domain" },
  { key: "attempts", label: "Attempts" },
  { key: "accuracy", label: "Accuracy" },
  { key: "retention", label: "Retention" },
  { key: "calibrationError", label: "Calibration err." },
  { key: "masteredShare", label: "Mastered" },
];

const ARROWS = { up: "↑", down: "↓", flat: "→" } as const;
const DAYS = [7, 30, 90] as const;

// O(n log n)
// INV: null sorts last in both directions
function sortRows(rows: Row[], key: SortKey, dir: 1 | -1): Row[] {
  return [...rows].sort((a, b) => {
    const x = a[key];
    const y = b[key];
    if (x === null && y === null) return 0;
    if (x === null) return 1;
    if (y === null) return -1;
    return (typeof x === "string" && typeof y === "string" ? x.localeCompare(y) : Number(x) - Number(y)) * dir;
  });
}

// O(days)
// INV: the server returns only days with attempts; this pads the window with empty UTC days so bars sit on a true time axis
function fillDays(daily: StatsResponse["daily"], days: number, now: Date): DailyPoint[] {
  const byDay = new Map(daily.map((d) => [d.day, d]));
  const out: DailyPoint[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = new Date(now.getTime() - i * 86_400_000).toISOString().slice(0, 10);
    const d = byDay.get(day);
    out.push({ day, attempts: d?.attempts ?? 0, accuracy: d?.accuracy ?? null });
  }
  return out;
}

function Insights(): JSX.Element {
  const [data, setData] = useState<InsightsResponse | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    let live = true;
    api("/api/insights", InsightsResponse).then((r) => live && setData(r), (e: unknown) => live && setError(e));
    return () => {
      live = false;
    };
  }, []);
  return (
    <Panel>
      <h2 className="mb-3 text-lg font-semibold">Trends noted by your tutor</h2>
      <ErrorBanner error={error} />
      {!data && !error && <Spinner label="Reading your progress" />}
      {data?.trends.length === 0 && <p className="text-sm text-muted">Nothing to report yet. Answer a few questions and check back.</p>}
      <ul className="flex flex-col gap-2">
        {data?.trends.map((t) => (
          <li key={t.text} className="flex items-start gap-3 rounded-xl bg-panel-2 px-4 py-3 text-sm">
            <span className="text-lg font-semibold leading-5 text-accent" role="img" aria-label={`trend ${t.direction}`}>{ARROWS[t.direction]}</span>
            <span>{t.text}</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

// O(days + topics log topics)
export function StatsPage(): JSX.Element {
  const [days, setDays] = useState<(typeof DAYS)[number]>(30);
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "attempts", dir: -1 });

  useEffect(() => {
    let live = true;
    api(`/api/stats?days=${days}`, StatsResponse).then((s) => live && (setStats(s), setError(null)), (e: unknown) => live && setError(e));
    return () => {
      live = false;
    };
  }, [days]);

  const rows = useMemo(() => (stats ? sortRows(stats.byTopic, sort.key, sort.dir) : []), [stats, sort]);
  const t = stats?.totals;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-semibold">Stats</h1>
        <div role="group" aria-label="Time range" className="flex gap-1 rounded-xl border border-border bg-panel p-1">
          {DAYS.map((d) => (
            <button key={d} type="button" aria-pressed={d === days} onClick={() => setDays(d)} className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${d === days ? "bg-accent text-on-accent" : "text-muted hover:text-text"}`}>
              {d} days
            </button>
          ))}
        </div>
      </div>
      <ErrorBanner error={error} />
      {!stats && !error && <Spinner label="Loading stats" />}
      {stats && t && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
            <StatTile label="Accuracy" value={fmtPct(t.accuracy)} hint={`${t.attempts} attempts`} />
            <StatTile label="Retention" value={fmtPct(t.retention)} hint="reviews answered right" />
            <StatTile label="Calibration error" value={fmtPct(t.calibrationError)} hint="lower is better" />
            <StatTile label="Streak" value={`${t.streakDays} ${t.streakDays === 1 ? "day" : "days"}`} />
            <StatTile label="Due now" value={String(t.dueNow)} />
            <StatTile label="Topics mastered" value={fmtPct(t.masteredShare)} hint={`of ${t.topicsStarted} started`} />
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            <Panel>
              <h2 className="mb-2 text-lg font-semibold">Daily attempts and accuracy</h2>
              <LineChart data={fillDays(stats.daily, days, new Date())} />
            </Panel>
            <Panel>
              <h2 className="mb-2 text-lg font-semibold">By domain</h2>
              <BarChart data={stats.byDomain.map((d) => ({ label: d.domain, accuracy: d.accuracy, retention: d.retention }))} />
            </Panel>
          </div>
          <Insights />
          <Panel className="overflow-x-auto">
            <h2 className="mb-3 text-lg font-semibold">Topics</h2>
            {rows.length === 0 ? (
              <p className="text-sm text-muted">No topics yet.</p>
            ) : (
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-border text-muted">
                    {COLS.map((c) => (
                      <th key={c.key} scope="col" aria-sort={sort.key === c.key ? (sort.dir === 1 ? "ascending" : "descending") : "none"} className="py-2 pr-4 font-medium">
                        <button type="button" className="hover:text-text" onClick={() => setSort((s) => ({ key: c.key, dir: s.key === c.key ? (s.dir === 1 ? -1 : 1) : c.key === "name" || c.key === "domain" ? 1 : -1 }))}>
                          {c.label} {sort.key === c.key ? (sort.dir === 1 ? "▲" : "▼") : ""}
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="border-b border-border/50 last:border-0">
                      <td className="py-2 pr-4 font-medium">{r.name}</td>
                      <td className="py-2 pr-4 text-muted">{r.domain}</td>
                      <td className="py-2 pr-4">{r.attempts}</td>
                      <td className="py-2 pr-4">{fmtPct(r.accuracy)}</td>
                      <td className="py-2 pr-4">{fmtPct(r.retention)}</td>
                      <td className="py-2 pr-4">{fmtPct(r.calibrationError)}</td>
                      <td className="py-2 pr-4">{fmtPct(r.masteredShare)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
        </>
      )}
    </div>
  );
}
