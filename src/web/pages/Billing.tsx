import { useEffect, useState, type JSX } from "react";
import { Link } from "wouter";
import { BillingResponse, UrlResponse } from "../../shared/api.ts";
import { api, describeError, isApiError } from "../api.ts";
import { Button } from "../components/Button.tsx";
import { Panel } from "../components/Panel.tsx";
import { PlanCard } from "../components/PlanCard.tsx";
import { useMe } from "../session.tsx";

// O(1) per poll
export function BillingPage(): JSX.Element {
  const me = useMe();
  const [billing, setBilling] = useState<BillingResponse | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  useEffect(() => { void api("/api/billing", BillingResponse).then(setBilling).catch((e) => setError(describeError(e))); }, []);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("ok") !== "1") return;
    let count = 0;
    const timer = window.setInterval(() => {
      count += 1;
      void api("/api/billing", BillingResponse).then((b) => { setBilling(b); if (b.plan === "pro") { setSuccess(true); window.clearInterval(timer); } else if (count >= 10) window.clearInterval(timer); }).catch(() => { if (count >= 10) window.clearInterval(timer); });
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);
  async function redirect(path: string, kind: string, prefix: string): Promise<void> {
    setBusy(kind); setError("");
    try { const response = await api(path, UrlResponse, { method: "POST" }); if (response.url.startsWith(prefix)) window.location.assign(response.url); else setError("Stripe returned an unexpected URL. Nothing was opened."); }
    catch (e) { setError(isApiError(e) && e.code === "already_subscribed" ? "You already have a Pro subscription." : describeError(e)); }
    finally { setBusy(null); }
  }
  return <div className="mx-auto grid max-w-3xl gap-5"><header><h1 className="text-2xl font-semibold">Billing</h1><p className="mt-1 text-sm text-muted">Manage your plan and payment details.</p></header>
    {billing ? <PlanCard billing={billing} capMicros={me.entitlement.capMicros} busy={busy} onSubscribe={() => void redirect("/api/billing/checkout", "checkout", "https://checkout.stripe.com/")} onPortal={() => void redirect("/api/billing/portal", "portal", "https://billing.stripe.com/")} /> : <Panel>Loading plan…</Panel>}
    {success && <div role="status" className="fixed bottom-5 right-5 z-50 rounded-xl border border-accent/50 bg-panel px-5 py-4 text-sm text-accent shadow-xl">Subscription confirmed. Your Pro access is ready.</div>}{error && <div role="alert"><Panel className="text-danger">{error}</Panel></div>}
    <div className="flex flex-wrap gap-4 text-sm"><Link href="/usage" className="text-accent underline">View usage</Link>{billing?.plan === "pro" && <Link href="/billing/cancel" className="text-accent underline">Cancel subscription</Link>}</div>
  </div>;
}
