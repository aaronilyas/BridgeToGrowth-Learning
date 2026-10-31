import { useEffect, useState, type JSX } from "react";
import { Link } from "wouter";
import { BillingResponse } from "../../shared/api.ts";
import { api, describeError } from "../api.ts";
import { Button } from "../components/Button.tsx";
import { Panel } from "../components/Panel.tsx";
import { usePlanTerms } from "../session.tsx";

// O(1)
function formatCancelDate(value: string | null): string {
  return value ? new Date(value).toLocaleDateString() : "the end of your billing period";
}

// O(1)
// INV: cancellation is cancel_at_period_end, so Pro stays until the paid period ends and can be resumed until then
export function CancelPage(): JSX.Element {
  const terms = usePlanTerms();
  const [billing, setBilling] = useState<BillingResponse | null>(null);
  const [understood, setUnderstood] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    void api("/api/billing", BillingResponse).then(setBilling, (e: unknown) => setMessage(describeError(e)));
  }, []);

  async function change(cancel: boolean): Promise<void> {
    setBusy(true);
    setMessage("");
    try {
      setBilling(await api(cancel ? "/api/billing/cancel" : "/api/billing/resume", BillingResponse, { method: "POST" }));
    } catch (e) {
      setMessage(`Stripe could not ${cancel ? "cancel" : "resume"} the subscription: ${describeError(e)}`);
    } finally {
      setBusy(false);
    }
  }

  if (!billing) return <div className="mx-auto max-w-2xl"><Panel>{message || "Loading subscription…"}</Panel></div>;
  if (billing.plan !== "pro") {
    return (
      <div className="mx-auto max-w-2xl">
        <Panel>
          <h1 className="text-xl font-semibold">No active subscription</h1>
          <p className="mt-2 text-sm text-muted">You're on the Free plan.</p>
          <Link href="/billing" className="mt-4 inline-block text-accent underline">Back to billing</Link>
        </Panel>
      </div>
    );
  }
  const canceling = billing.cancelAtPeriodEnd;
  const ttl = terms ? `${terms.free.lessonTtlDays} days` : "a week";
  return (
    <div className="mx-auto grid max-w-2xl gap-5">
      <header>
        <h1 className="text-2xl font-semibold">{canceling ? "Subscription ending" : "Cancel subscription"}</h1>
      </header>
      <Panel className="grid gap-4">
        {canceling ? (
          <>
            <p>Pro stays active until {formatCancelDate(billing.periodEnd)}, then your account moves to the Free plan.</p>
            <Button onClick={() => void change(false)} busy={busy}>Resume subscription</Button>
          </>
        ) : (
          <>
            <p>You won't be charged again. Pro stays active until {formatCancelDate(billing.periodEnd)}.</p>
            <div>
              <h2 className="font-semibold">After that</h2>
              <ul className="mt-1 list-disc pl-5 text-sm text-muted">
                <li>Your monthly AI usage drops to the Free allowance.</li>
                <li>Settings go back to the defaults and personal stats are locked. Your saved settings and history are kept for when you return.</li>
                <li>Lessons you already have are kept. New lessons are deleted after {ttl}.</li>
              </ul>
            </div>
            <label className="flex items-center gap-3 text-sm">
              <input type="checkbox" checked={understood} onChange={(e) => setUnderstood(e.currentTarget.checked)} className="size-4 accent-accent" />
              I understand
            </label>
            <Button variant="danger" disabled={!understood} busy={busy} onClick={() => void change(true)}>Confirm cancellation</Button>
          </>
        )}
        {message && <p role="alert" className="text-sm text-danger">{message}</p>}
      </Panel>
      <Link href="/billing" className="text-sm text-accent underline">Back to billing</Link>
    </div>
  );
}
