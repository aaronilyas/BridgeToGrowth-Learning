import { useEffect, useState, type JSX } from "react";
import { Link } from "wouter";
import { BillingResponse } from "../../shared/api.ts";
import { api, describeError } from "../api.ts";
import { Button } from "../components/Button.tsx";
import { Panel } from "../components/Panel.tsx";

function formatCancelDate(value: string | null): string { return value ? new Date(value).toLocaleDateString() : "your billing period end"; }

// O(1)
export function CancelPage(): JSX.Element {
  const [billing, setBilling] = useState<BillingResponse | null>(null);
  const [understood, setUnderstood] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => { void api("/api/billing", BillingResponse).then(setBilling).catch((e) => setMessage(describeError(e))); }, []);
  async function change(cancel: boolean): Promise<void> {
    setBusy(true); setMessage("");
    try { setBilling(await api(cancel ? "/api/billing/cancel" : "/api/billing/resume", BillingResponse, { method: "POST" })); }
    catch (e) { setMessage(`Stripe could not ${cancel ? "cancel" : "resume"} the subscription: ${describeError(e)}`); }
    finally { setBusy(false); }
  }
  if (!billing) return <div className="mx-auto max-w-2xl"><Panel>{message || "Loading subscription…"}</Panel></div>;
  if (billing.plan !== "pro") return <div className="mx-auto max-w-2xl"><Panel><h1 className="text-xl font-semibold">No active subscription</h1><p className="mt-2 text-sm text-muted">Manage your plan from billing.</p><Link href="/billing" className="mt-4 inline-block text-accent underline">Back to billing</Link></Panel></div>;
  const canceling = billing.cancelAtPeriodEnd;
  return <div className="mx-auto grid max-w-2xl gap-5"><header><h1 className="text-2xl font-semibold">{canceling ? "Subscription ending" : "Cancel subscription"}</h1></header><Panel className="grid gap-4">
    {canceling ? <><p>Access until {formatCancelDate(billing.periodEnd)}. Your graph, stats, and learning history will be kept.</p><Button onClick={() => void change(false)} busy={busy}>Resume subscription</Button></> : <><p>Pro access stops on {formatCancelDate(billing.periodEnd)}.</p><div><h2 className="font-semibold">What you keep</h2><p className="mt-1 text-sm text-muted">Your graph, stats, and learning history remain available.</p></div><label className="flex items-center gap-3 text-sm"><input type="checkbox" checked={understood} onChange={(e) => setUnderstood(e.currentTarget.checked)} className="size-4 accent-accent" />I understand</label><Button variant="danger" disabled={!understood} busy={busy} onClick={() => void change(true)}>Confirm cancellation</Button></>}
    {message && <p role="alert" className="text-sm text-danger">{message}</p>}</Panel><Link href="/billing" className="text-sm text-accent underline">Back to billing</Link></div>;
}
