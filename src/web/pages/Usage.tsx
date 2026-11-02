import { useEffect, useState, type JSX } from "react";
import { UsageResponse, type UsageModel } from "../../shared/api.ts";
import { api, describeError } from "../api.ts";
import { Panel } from "../components/Panel.tsx";
import { spentUsd, UsageMeter } from "../components/UsageMeter.tsx";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

function resetDate(month: string): string {
  const [year, mon] = month.split("-");
  const y = Number(year);
  const m = Number(mon);
  if (!Number.isFinite(y) || !Number.isFinite(m)) return month;
  return new Date(Date.UTC(y, m, 1)).toLocaleDateString(undefined, { timeZone: "UTC" });
}

function costLabel(cost: number | null): string {
  return cost === null ? "—" : money.format(cost);
}

function ModelRows({ rows }: { rows: readonly UsageModel[] }): JSX.Element {
  if (!rows.length) return <p className="text-sm text-muted">No calls.</p>;
  return <div className="grid gap-2">{rows.map((row) => <div key={`${row.provider}:${row.model}`} className="flex justify-between gap-4 text-sm"><span className="break-all">{row.provider}/{row.model}</span><span>{row.inputTokens} in · {row.outputTokens} out · {costLabel(row.costUsd)}</span></div>)}</div>;
}

// O(n) in the returned usage rows
export function UsagePage(): JSX.Element {
  const [usage, setUsage] = useState<UsageResponse | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { void api("/api/usage", UsageResponse).then(setUsage).catch((e) => setError(describeError(e))); }, []);
  if (error) return <Panel className="text-danger">{error}</Panel>;
  if (!usage) return <Panel>Loading usage…</Panel>;
  return <div className="mx-auto grid max-w-4xl gap-5"><header><h1 className="text-2xl font-semibold">Usage</h1><p className="mt-1 text-sm text-muted">This month's usage resets {resetDate(usage.month)}.</p></header>
    <UsageMeter spent={spentUsd(usage.current)} />
    <Panel><h2 className="mb-3 text-lg font-semibold">This month</h2><ModelRows rows={usage.current} /></Panel>
    <Panel><h2 className="mb-3 text-lg font-semibold">Recent months</h2>{usage.recent.length ? usage.recent.map((month) => <div key={month.period} className="mb-4"><p className="mb-2 text-sm text-muted">{month.period}</p><ModelRows rows={month.models} /></div>) : <p className="text-sm text-muted">No earlier months.</p>}</Panel>
  </div>;
}
