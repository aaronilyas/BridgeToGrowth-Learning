import { useEffect, useMemo, useState, type JSX } from "react";
import { Link, useLocation } from "wouter";
import { z } from "zod";
import { LessonSummary, StatsResponse } from "../../shared/api.ts";
import { api } from "../api.ts";
import { generatingLessonPrompt, useAskJob } from "../askJob.ts";
import { Logo } from "./Logo.tsx";
import { Spinner } from "./Spinner.tsx";
import { UsageCard } from "./UsageMeter.tsx";

export type SessionFilter = "all" | "waiting" | "done";

const FILTERS: { id: SessionFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "waiting", label: "Waiting" },
  { id: "done", label: "Done" },
];
const STATUS_TEXT: Record<LessonSummary["status"], string> = { waiting: "Waiting for your answer", active: "In progress", done: "Completed" };

// O(1)
// INV: under a week it is relative; older than that it is the UTC calendar date
export function relativeTime(iso: string, now: number = Date.now()): string {
  const s = Math.max(0, Math.floor((now - Date.parse(iso)) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d ago`;
  return iso.slice(0, 10);
}

// O(n) in lessons
// INV: "all" keeps every status; "waiting" and "done" match status exactly; the query is a case-insensitive title substring
export function filterSessions(rows: readonly LessonSummary[], filter: SessionFilter, query: string): LessonSummary[] {
  const q = query.trim().toLowerCase();
  return rows.filter((l) => (filter === "all" || l.status === filter) && (q === "" || l.title.toLowerCase().includes(q)));
}

const navClass = "flex items-center gap-2 rounded-lg px-2 py-1.5 font-mono text-xs uppercase tracking-[0.08em] text-muted transition hover:bg-panel-2 hover:text-text";

// O(1)
export function SidebarToggle({ onClick, label }: { onClick: () => void; label: string }): JSX.Element {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label} className="rounded-lg p-1.5 text-muted transition hover:bg-panel-2 hover:text-text focus-visible:outline-2 focus-visible:outline-accent">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M9 4v16" />
      </svg>
    </button>
  );
}

// O(1)
// INV: a lesson in planning is not in /api/lessons yet, so it is listed from askJob above the saved rows
export function GeneratingLesson({ prompt }: { prompt: string }): JSX.Element {
  return (
    <li className="flex flex-col gap-0.5 rounded-lg bg-panel-2 px-3 py-2" aria-busy="true" aria-live="polite">
      <span className="truncate text-sm text-text">{prompt}</span>
      <Spinner size={11} label="Planning…" />
    </li>
  );
}

// O(n) in lessons
// INV: refetches on every location change and on the "btg:lessons-changed" window event, so the list tracks lesson creation and deletion
function useLessons(): LessonSummary[] | null {
  const [location] = useLocation();
  const [rows, setRows] = useState<LessonSummary[] | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const bump = (): void => setTick((n) => n + 1);
    window.addEventListener("btg:lessons-changed", bump);
    return () => window.removeEventListener("btg:lessons-changed", bump);
  }, []);
  useEffect(() => {
    let live = true;
    api("/api/lessons?limit=20", z.array(LessonSummary)).then((l) => live && setRows(l), () => undefined);
    return () => {
      live = false;
    };
  }, [location, tick]);
  return rows;
}

// O(1)
function useDue(): { due: number; goal: { done: number; target: number } | null } {
  const [location] = useLocation();
  const [state, setState] = useState<{ due: number; goal: { done: number; target: number } | null }>({ due: 0, goal: null });
  useEffect(() => {
    let live = true;
    api("/api/stats?days=7", StatsResponse).then((s) => live && setState({ due: s.totals.dueNow, goal: s.totals.goalToday }), () => undefined);
    return () => {
      live = false;
    };
  }, [location]);
  return state;
}

// O(n) in lessons
export function Sidebar({ onCollapse }: { onCollapse: () => void }): JSX.Element {
  const [location] = useLocation();
  const lessons = useLessons();
  const { due, goal } = useDue();
  const generating = generatingLessonPrompt(useAskJob());
  const [filter, setFilter] = useState<SessionFilter>("all");
  const [query, setQuery] = useState("");
  const shown = useMemo(() => filterSessions(lessons ?? [], filter, query), [lessons, filter, query]);
  const pct = goal && goal.target > 0 ? Math.min(100, Math.round((goal.done / goal.target) * 100)) : null;
  const here = location.startsWith("/lesson/") ? location.slice("/lesson/".length).split("/")[0] : null;
  return (
    <aside aria-label="Sidebar" className="flex h-screen w-72 shrink-0 flex-col border-r border-border bg-panel">
      <div className="flex items-center justify-between px-4 pt-4 pb-3">
        <Link href="/teach" aria-label="Home">
          <Logo />
        </Link>
        <SidebarToggle onClick={onCollapse} label="Hide sidebar" />
      </div>
      <nav aria-label="Main" className="flex flex-col gap-0.5 px-3">
        <Link href="/teach" className={navClass}>
          <span aria-hidden="true">+</span> New lesson
        </Link>
        <Link href="/practice" aria-current={location === "/practice" ? "page" : undefined} className={navClass}>
          Practice
          {due > 0 && <span className="ml-auto text-accent">{due} due</span>}
        </Link>
      </nav>
      <div className="mt-3 flex items-center gap-2 px-4">
        <span className="label">Sessions</span>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
          placeholder="Search…"
          aria-label="Search sessions"
          className="min-w-0 flex-1 rounded-lg border border-border bg-bg px-2 py-1 font-mono text-xs text-text outline-none placeholder:text-muted focus:border-accent"
        />
      </div>
      <div role="tablist" aria-label="Filter sessions" className="mx-4 mt-2 grid grid-cols-3 rounded-lg border border-border bg-bg p-0.5">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            role="tab"
            aria-selected={filter === f.id}
            onClick={() => setFilter(f.id)}
            className={`rounded-md px-2 py-1 font-mono text-[0.68rem] uppercase tracking-[0.08em] transition ${filter === f.id ? "bg-panel-2 text-text" : "text-muted hover:text-text"}`}
          >
            {f.label}
          </button>
        ))}
      </div>
      <ul className="scroll-quiet mt-2 flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 pb-2">
        {generating && <GeneratingLesson prompt={generating} />}
        {shown.map((l) => (
          <li key={l.id}>
            <Link href={`/lesson/${l.id}`} aria-current={here === l.id ? "page" : undefined} className={`flex flex-col gap-0.5 rounded-lg px-3 py-2 transition hover:bg-panel-2 ${here === l.id ? "bg-panel-2" : ""}`}>
              <span className="truncate text-sm text-text">{l.title}</span>
              <span className="truncate font-mono text-[0.68rem] text-muted">
                {STATUS_TEXT[l.status]} · {relativeTime(l.lastActiveAt)}
              </span>
            </Link>
          </li>
        ))}
        {lessons !== null && shown.length === 0 && !generating && <li className="px-3 py-2 text-xs text-muted">{lessons.length === 0 ? "No sessions yet." : "No matching sessions."}</li>}
      </ul>
      <div className="flex flex-col gap-2 border-t border-border px-4 py-3">
        <UsageCard />
        {pct !== null && goal && (
          <div className="flex items-center gap-2" title={`Today's goal: ${goal.done} / ${goal.target}`}>
            <span className="label">Today</span>
            <div className="h-0.5 flex-1 overflow-hidden rounded-full bg-border" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Daily goal">
              <div className="h-full bg-accent transition-[width]" style={{ width: `${pct}%` }} />
            </div>
          </div>
        )}
        <nav aria-label="Secondary" className="flex gap-3 font-mono text-[0.7rem] uppercase tracking-[0.08em] text-muted">
          {(["graph", "stats", "settings"] as const).map((p) => (
            <Link key={p} href={`/${p}`} aria-current={location === `/${p}` ? "page" : undefined} className={`transition hover:text-text ${location === `/${p}` ? "text-text" : ""}`}>
              {p}
            </Link>
          ))}
        </nav>
      </div>
    </aside>
  );
}
