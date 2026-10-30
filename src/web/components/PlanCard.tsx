import type { JSX } from "react";
import type { BillingResponse } from "../../shared/api.ts";
import { Button } from "./Button.tsx";
import { Panel } from "./Panel.tsx";

const money = new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" });
function formatPlanDate(value: string | null): string { return value ? new Date(value).toLocaleDateString() : "the end of your billing period"; }

// O(1)
export function PlanCard({ billing, capMicros, busy, onSubscribe, onPortal }: { billing: BillingResponse; capMicros: number; busy: string | null; onSubscribe: () => void; onPortal: () => void }): JSX.Element {
  const days = Math.max(0, Math.ceil((new Date(billing.trialEndsAt).getTime() - Date.now()) / 86_400_000));
  return <Panel className="grid gap-4"><div><p className="text-sm font-medium uppercase tracking-wide text-muted">Current plan</p><h2 className="mt-1 text-2xl font-semibold">{billing.plan === "pro" ? "Pro" : billing.plan === "trial" ? "Free trial" : "Trial ended"}</h2></div>
    {billing.plan === "trial" && <><p>{days} days left</p><p className="text-sm text-muted">Monthly AI cap: {money.format(capMicros / 1e6)}</p><Button busy={busy === "checkout"} onClick={onSubscribe}>Subscribe</Button></>}
    {billing.plan === "none" && <><p className="text-muted">Your free trial has ended.</p><Button busy={busy === "checkout"} onClick={onSubscribe}>Subscribe</Button></>}
    {billing.plan === "pro" && <><p>{billing.cancelAtPeriodEnd ? "Ends" : "Renews"} {formatPlanDate(billing.periodEnd)}</p><Button variant="soft" busy={busy === "portal"} onClick={onPortal}>Manage payment</Button></>}
  </Panel>;
}
