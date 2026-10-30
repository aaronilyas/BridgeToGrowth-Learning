import { useEffect, useState, type JSX, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { StatsResponse } from "../../shared/api.ts";
import { api } from "../api.ts";
import { useMe, useSession } from "../session.tsx";
import { Logo } from "./Logo.tsx";

const NAV: { href: string; label: string; icon: string }[] = [
  { href: "/teach", label: "Teach", icon: "M4 5.5A2.5 2.5 0 0 1 6.5 3H12v17H6.5A2.5 2.5 0 0 0 4 22.5zM20 5.5A2.5 2.5 0 0 0 17.5 3H12v17h5.5a2.5 2.5 0 0 1 2.5 2.5z" },
  { href: "/practice", label: "Practice", icon: "M9 3h6M10 3v6L4.5 19a1.5 1.5 0 0 0 1.3 2.2h12.4a1.5 1.5 0 0 0 1.3-2.2L14 9V3M7 15h10" },
  { href: "/graph", label: "Graph", icon: "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM5 4a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM19 4a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM5 16a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM19 16a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM6.5 7.5l3.3 3M17.5 7.5l-3.3 3M6.5 16.5l3.3-3M17.5 16.5l-3.3-3" },
  { href: "/stats", label: "Stats", icon: "M4 20V10M10 20V4M16 20v-7M22 20H2" },
  { href: "/settings", label: "Settings", icon: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" },
  { href: "/billing", label: "Billing", icon: "M2 7a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2zM2 10h20M6 15h4" },
];

function NavIcon({ d }: { d: string }): JSX.Element {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

function ProgressCard(): JSX.Element | null {
  const [location] = useLocation();
  const [goal, setGoal] = useState<{ done: number; target: number } | null>(null);
  useEffect(() => {
    let live = true;
    api("/api/stats?days=7", StatsResponse).then((s) => live && setGoal(s.totals.goalToday), () => undefined);
    return () => {
      live = false;
    };
  }, [location]);
  if (!goal) return null;
  const pct = Math.min(100, Math.round((goal.done / goal.target) * 100));
  return (
    <div className="rounded-xl border border-border bg-panel-2 p-4">
      <p className="text-sm text-muted">Today's progress</p>
      <p className="mt-1 text-2xl font-semibold text-accent">
        {goal.done}
        <span className="text-base font-medium text-muted"> / {goal.target}</span>
      </p>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-border" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Daily goal">
        <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-2 text-xs text-accent-2">{pct >= 100 ? "Goal reached. Nice work!" : "Keep going!"}</p>
    </div>
  );
}

// O(1)
export function AppShell({ children }: { children: ReactNode }): JSX.Element {
  const [location, navigate] = useLocation();
  const me = useMe();
  const { signOut } = useSession();
  return (
    <div className="relative z-10 flex min-h-screen gap-3 p-3">
      <aside className="sticky top-3 flex h-[calc(100vh-1.5rem)] w-60 shrink-0 flex-col gap-6 rounded-2xl border border-border bg-panel p-4">
        <Link href="/teach" className="px-2 pt-1">
          <Logo />
        </Link>
        <nav aria-label="Main" className="flex flex-col gap-1">
          {NAV.map((n) => {
            const active = location === n.href || location.startsWith(`${n.href}/`) || (n.href === "/teach" && location.startsWith("/lesson"));
            return (
              <Link
                key={n.href}
                href={n.href}
                aria-current={active ? "page" : undefined}
                className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 text-sm font-medium transition ${active ? "border-accent/40 bg-accent-soft text-accent" : "border-transparent text-muted hover:bg-panel-2 hover:text-text"}`}
              >
                <NavIcon d={n.icon} />
                {n.label}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto flex flex-col gap-3">
          <ProgressCard />
          <div className="flex items-center justify-between gap-2 px-1 text-xs text-muted">
            <span className="truncate" title={me.email}>{me.email}</span>
            <button type="button" className="shrink-0 rounded-md px-2 py-1 hover:bg-panel-2 hover:text-text" onClick={() => void signOut().then(() => navigate("/login"))}>
              Sign out
            </button>
          </div>
        </div>
      </aside>
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
