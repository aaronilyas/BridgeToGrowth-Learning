import { useEffect, useState, type JSX } from "react";
import { Link } from "wouter";
import { UsageResponse } from "../../shared/api.ts";
import { api, describeError } from "../api.ts";
import { Button } from "../components/Button.tsx";
import { Panel } from "../components/Panel.tsx";
import { UsageMeter } from "../components/UsageMeter.tsx";

const money = new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" });
function formatDollars(micros: number): string { return money.format(micros / 1e6); }
function resetDate(period: string): string { const d = new Date(`${period}T00:00:00.000Z`); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toLocaleDateString(undefined, { timeZone: "UTC" }); }
function formatCallCost(micros: number): string { return `$${(micros / 1e6).toFixed(4)}`; }

// O(n) in the returned usage rows
export function UsagePage(): JSX.Element {
  const [usage, setUsage] = useState<UsageResponse | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { void api("/api/usage", UsageResponse).then(setUsage).catch((e) => setError(describeError(e))); }, []);
  if (error) return <Panel className="text-danger">{error}</Panel>;
  if (!usage) return <Panel>Loading usage…</Panel>;
  return <div className="mx-auto grid max-w-4xl gap-5"><header><h1 className="text-2xl font-semibold">Usage</h1><p className="mt-1 text-sm text-muted">Your AI usage resets {resetDate(usage.period)}.</p></header>
    <UsageMeter usedMicros={usage.usedMicros} reservedMicros={usage.reservedMicros} capMicros={usage.capMicros} />
    {usage.plan === "trial" && <Panel className="flex flex-wrap items-center justify-between gap-4"><div><h2 className="font-semibold">Need more room?</h2><p className="text-sm text-muted">Upgrade for a higher monthly AI cap.</p></div><Link href="/billing"><Button>Upgrade plan</Button></Link></Panel>}
    <Panel><h2 className="mb-3 text-lg font-semibold">Cost by model</h2>{usage.byModel.length ? <div className="grid gap-2">{usage.byModel.map((item) => <div key={item.model} className="flex justify-between gap-4 text-sm"><span className="break-all">{item.model}</span><span>{formatDollars(item.costMicros)}</span></div>)}</div> : <p className="text-sm text-muted">No calls this month.</p>}</Panel>
    <Panel><h2 className="mb-3 text-lg font-semibold">Recent calls</h2><div className="overflow-x-auto"><table className="w-full min-w-[36rem] text-left text-sm"><thead className="text-muted"><tr><th className="pb-2">Kind</th><th>Model</th><th>Cost</th><th>Time</th></tr></thead><tbody>{usage.recent.slice(0, 20).map((call, index) => <tr key={`${call.createdAt}-${index}`} className="border-t border-border"><td className="py-2">{call.kind}</td><td className="max-w-64 truncate">{call.model}</td><td>{formatCallCost(call.costMicros)}</td><td>{new Date(call.createdAt).toLocaleString()}</td></tr>)}</tbody></table>{!usage.recent.length && <p className="text-sm text-muted">No recent calls.</p>}</div></Panel>
  </div>;
}
