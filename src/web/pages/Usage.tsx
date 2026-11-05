import { useEffect, useState, type JSX } from "react";
import { UsageResponse, type UsageModel } from "../../shared/api.ts";
import type { ProviderId } from "../../shared/providers.ts";
import { api, describeError } from "../api.ts";
import { StatTile } from "../charts/StatTile.tsx";
import { Panel } from "../components/Panel.tsx";
import { summarizeReportedCost, sumOpenRouterUsd, UsageMeter } from "../components/UsageMeter.tsx";
import { titleOfProvider } from "../providerCopy.ts";
import { useSettings } from "../session.tsx";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const tokens = new Intl.NumberFormat("en-US");
const PROVIDER_ORDER: readonly ProviderId[] = ["openrouter", "codex", "spacexai"];

// O(1)
function monthPeriodLabel(period: string): string {
  const [year, mon] = period.split("-");
  const y = Number(year);
  const m = Number(mon);
  if (!Number.isFinite(y) || !Number.isFinite(m)) return period;
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" });
}

// O(1)
function usageUntilLabel(period: string): string {
  const [year, mon] = period.split("-");
  const y = Number(year);
  const m = Number(mon);
  if (!Number.isFinite(y) || !Number.isFinite(m)) return period;
  return new Date(Date.UTC(y, m, 1)).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}

// O(1)
function listPeriods(usage: UsageResponse): string[] {
  return [...new Set([usage.month, ...usage.recent.map((month) => month.period)])].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
}

// O(n)
function rowsOfPeriod(usage: UsageResponse, period: string): UsageModel[] {
  if (period === usage.month) return usage.current;
  return usage.recent.find((month) => month.period === period)?.models ?? [];
}

// O(n)
function sumTokenField(rows: readonly UsageModel[], key: "inputTokens" | "outputTokens"): number {
  return rows.reduce((sum, row) => sum + row[key], 0);
}

// O(n)
function UsageRows({ rows }: { rows: readonly UsageModel[] }): JSX.Element {
  if (rows.length === 0) return <p className="text-sm text-muted">No calls.</p>;
  const max = Math.max(1, ...rows.map((row) => row.inputTokens + row.outputTokens));
  return (
    <div className="grid gap-3">
      {rows.map((row) => {
        const width = Math.round(((row.inputTokens + row.outputTokens) / max) * 100);
        return (
          <div key={`${row.provider}:${row.model}`} className="grid gap-1 text-sm">
            <div className="flex justify-between gap-4">
              <span className="break-all">{titleOfProvider(row.provider)} · {row.model}</span>
              <span className="shrink-0 text-muted">{tokens.format(row.inputTokens)} in · {tokens.format(row.outputTokens)} out{row.costUsd === null ? "" : ` · ${money.format(row.costUsd)}`}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-border" aria-hidden="true">
              <div className="h-full rounded-full bg-accent" style={{ width: `${width}%` }} />
            </div>
            {row.costUsd === null && <p className="text-xs text-muted">Cost not reported</p>}
          </div>
        );
      })}
    </div>
  );
}

// O(n) in the returned usage rows
export function UsagePage(): JSX.Element {
  const { settings } = useSettings();
  const [usage, setUsage] = useState<UsageResponse | null>(null);
  const [period, setPeriod] = useState<string | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    void api("/api/usage", UsageResponse).then(setUsage).catch((cause) => setError(describeError(cause)));
  }, []);
  if (error) return <Panel className="text-danger">{error}</Panel>;
  if (!usage) return <Panel>Loading usage…</Panel>;
  const selected = period ?? usage.month;
  const rows = rowsOfPeriod(usage, selected);
  const periods = listPeriods(usage);
  const reported = summarizeReportedCost(rows);
  const openRouterSpent = sumOpenRouterUsd(rows);
  const showMeter = selected === usage.month && (settings.budgetUsd !== null || (openRouterSpent !== null && openRouterSpent > 0));
  const groups = PROVIDER_ORDER.map((provider) => ({ provider, rows: rows.filter((row) => row.provider === provider) })).filter((group) => group.rows.length > 0);
  return (
    <div className="mx-auto grid max-w-4xl gap-5">
      <header>
        <h1 className="display text-2xl">Usage</h1>
        <p className="mt-1 text-sm text-muted">Tokens for {monthPeriodLabel(selected)}. {selected === usage.month ? `This month runs until ${usageUntilLabel(usage.month)}.` : ""} USD is shown only when a provider reports it.</p>
      </header>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Month">
        {periods.map((item) => (
          <button key={item} type="button" aria-pressed={item === selected} className={`rounded-full border px-3 py-1.5 text-sm ${item === selected ? "border-accent/40 bg-accent-soft text-accent" : "border-border text-muted hover:text-text"}`} onClick={() => setPeriod(item)}>
            {monthPeriodLabel(item)}
          </button>
        ))}
      </div>
      {showMeter && <UsageMeter spent={openRouterSpent} budget={selected === usage.month ? settings.budgetUsd : null} />}
      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile label="Input tokens" value={tokens.format(sumTokenField(rows, "inputTokens"))} />
        <StatTile label="Output tokens" value={tokens.format(sumTokenField(rows, "outputTokens"))} />
        <StatTile label="Reported cost" value={reported.amount === null ? "—" : money.format(reported.amount)} hint={reported.amount === null ? "Not reported" : reported.partial ? "Some calls did not report a cost" : "Reported by the provider"} />
      </div>
      {groups.length === 0 ? <Panel><p className="text-sm text-muted">No calls.</p></Panel> : groups.map((group) => (
        <Panel key={group.provider}>
          <h2 className="mb-3 display text-lg">{titleOfProvider(group.provider)}</h2>
          <UsageRows rows={group.rows} />
        </Panel>
      ))}
    </div>
  );
}
