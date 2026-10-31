import { useEffect, useState, type JSX } from "react";
import { Link } from "wouter";
import { BillingResponse, UrlResponse } from "../../shared/api.ts";
import { api, describeError } from "../api.ts";
import { Panel } from "../components/Panel.tsx";
import { PlanCard } from "../components/PlanCard.tsx";
import { usePlanTerms, useSession } from "../session.tsx";

const POLLS = 10;
const POLL_MS = 1500;

// O(1) per poll
// INV: after checkout (?ok=1) the page asks the server to sync from Stripe, then polls until the plan turns pro or POLLS run out; the webhook remains the source of truth
export function BillingPage(): JSX.Element {
  const terms = usePlanTerms();
  const { refresh } = useSession();
  const [billing, setBilling] = useState<BillingResponse | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [returned] = useState(() => new URLSearchParams(window.location.search).get("ok") === "1");

  useEffect(() => {
    let live = true;
    let timer = 0;
    if (returned) window.history.replaceState(null, "", "/billing");
    const settle = (b: BillingResponse): boolean => {
      if (!live) return true;
      setBilling(b);
      if (returned && b.plan === "pro") {
        setSuccess(true);
        void refresh();
        return true;
      }
      return false;
    };
    const poll = (left: number): void => {
      timer = window.setTimeout(() => {
        void api("/api/billing", BillingResponse).then(
          (b) => !settle(b) && left > 1 && poll(left - 1),
          () => left > 1 && poll(left - 1),
        );
      }, POLL_MS);
    };
    const first = returned ? api("/api/billing/sync", BillingResponse, { method: "POST" }) : api("/api/billing", BillingResponse);
    first.then(
      (b) => !settle(b) && returned && poll(POLLS),
      (e: unknown) => {
        if (!live) return;
        setError(describeError(e));
        if (returned) poll(POLLS);
      },
    );
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [refresh, returned]);

  async function redirect(path: string, kind: string, prefix: string): Promise<void> {
    setBusy(kind);
    setError("");
    try {
      const response = await api(path, UrlResponse, { method: "POST" });
      if (response.url.startsWith(prefix)) window.location.assign(response.url);
      else setError("Stripe returned an unexpected URL. Nothing was opened.");
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto grid max-w-4xl gap-5">
      <header>
        <h1 className="text-2xl font-semibold">Billing</h1>
        <p className="mt-1 text-sm text-muted">Manage your plan and payment details. Payments are handled by Stripe.</p>
      </header>
      {billing && terms ? (
        <PlanCard billing={billing} terms={terms} busy={busy} onSubscribe={() => void redirect("/api/billing/checkout", "checkout", "https://checkout.stripe.com/")} onPortal={() => void redirect("/api/billing/portal", "portal", "https://billing.stripe.com/")} />
      ) : (
        !error && <Panel>Loading plan…</Panel>
      )}
      {success && (
        <div role="status" className="fixed bottom-5 right-5 z-50 rounded-xl border border-accent/50 bg-panel px-5 py-4 text-sm text-accent shadow-xl">
          Subscription confirmed. Your Pro access is ready.
        </div>
      )}
      {error && (
        <div role="alert">
          <Panel className="text-danger">{error}</Panel>
        </div>
      )}
      <div className="flex flex-wrap gap-4 text-sm">
        <Link href="/usage" className="text-accent underline">
          View usage
        </Link>
        {billing?.plan === "pro" && (
          <Link href="/billing/cancel" className="text-accent underline">
            {billing.cancelAtPeriodEnd ? "Resume subscription" : "Cancel subscription"}
          </Link>
        )}
      </div>
    </div>
  );
}
