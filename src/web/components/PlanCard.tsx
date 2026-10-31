import type { JSX } from "react";
import type { BillingResponse, PlanTerms } from "../../shared/api.ts";
import { formatCents, formatMicros } from "../money.ts";
import { Button } from "./Button.tsx";
import { Panel } from "./Panel.tsx";

// O(1)
function formatPlanDate(value: string | null): string {
  return value ? new Date(value).toLocaleDateString() : "the end of your billing period";
}

// O(1)
function Feature({ on, children }: { on: boolean; children: string }): JSX.Element {
  return (
    <li className={`flex gap-2 text-sm ${on ? "" : "text-muted"}`}>
      <span aria-hidden="true" className={on ? "text-accent" : ""}>{on ? "✓" : "–"}</span>
      <span>{children}</span>
    </li>
  );
}

// O(1)
// INV: shows both plans side by side; the current plan is labelled and only the other plan has an action
export function PlanCard({ billing, terms, busy, onSubscribe, onPortal }: { billing: BillingResponse; terms: PlanTerms; busy: string | null; onSubscribe: () => void; onPortal: () => void }): JSX.Element {
  const pro = billing.plan === "pro";
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Panel className={`flex flex-col gap-4 ${pro ? "" : "border-accent/50"}`}>
        <div>
          <p className="text-sm font-medium uppercase tracking-wide text-muted">{pro ? "Free" : "Current plan"}</p>
          <h2 className="mt-1 text-2xl font-semibold">Free</h2>
          <p className="text-muted">$0 / month</p>
        </div>
        <ul className="grid gap-2">
          <Feature on>{`${formatMicros(terms.free.capMicros)} of AI usage each month`}</Feature>
          <Feature on>Lessons, practice and the knowledge graph</Feature>
          <Feature on={false}>{`Lessons are deleted after ${terms.free.lessonTtlDays} days`}</Feature>
          <Feature on={false}>Configurable settings and model choice</Feature>
          <Feature on={false}>Personal stats and insights</Feature>
        </ul>
      </Panel>
      <Panel className={`flex flex-col gap-4 ${pro ? "border-accent/50" : ""}`}>
        <div>
          <p className="text-sm font-medium uppercase tracking-wide text-muted">{pro ? "Current plan" : "Upgrade"}</p>
          <h2 className="mt-1 text-2xl font-semibold">Pro</h2>
          <p className="text-muted">{formatCents(terms.pro.priceCents)} / month</p>
        </div>
        <ul className="grid gap-2">
          <Feature on>{`${formatMicros(terms.pro.capMicros)} of AI usage each month`}</Feature>
          <Feature on>Lessons are kept for good</Feature>
          <Feature on>Configurable settings and model choice</Feature>
          <Feature on>Personal stats and insights</Feature>
        </ul>
        <div className="mt-auto grid gap-2">
          {pro && billing.subStatus === "past_due" && <p className="text-sm text-danger">Your last payment failed. Update your card to keep Pro.</p>}
          {pro && <p className="text-sm">{billing.cancelAtPeriodEnd ? "Ends" : "Renews"} {formatPlanDate(billing.periodEnd)}</p>}
          {pro ? (
            <Button variant="soft" busy={busy === "portal"} onClick={onPortal}>
              Manage payment
            </Button>
          ) : (
            <Button busy={busy === "checkout"} onClick={onSubscribe}>
              Subscribe for {formatCents(terms.pro.priceCents)}/month
            </Button>
          )}
        </div>
      </Panel>
    </div>
  );
}
