import type { JSX, ReactNode } from "react";
import { Link } from "wouter";
import { formatCents, formatMicros } from "../money.ts";
import { useIsPro, usePlanTerms } from "../session.tsx";
import { Button } from "./Button.tsx";
import { Panel } from "./Panel.tsx";

// O(1)
export function UpgradeNotice({ feature, detail }: { feature: string; detail: string }): JSX.Element {
  const terms = usePlanTerms();
  return (
    <div className="mx-auto grid max-w-2xl gap-4">
      <Panel className="flex flex-col gap-3">
        <p className="text-sm font-medium uppercase tracking-wide text-accent">Pro feature</p>
        <h1 className="text-2xl font-semibold">{feature}</h1>
        <p className="text-muted">{detail}</p>
        {terms && (
          <p className="text-sm text-muted">
            Pro is {formatCents(terms.pro.priceCents)} a month and includes {formatMicros(terms.pro.capMicros)} of AI usage, configurable settings, personal stats and lessons that are never deleted.
          </p>
        )}
        <div>
          <Link href="/billing">
            <Button>Upgrade to Pro</Button>
          </Link>
        </div>
      </Panel>
    </div>
  );
}

// O(1)
// INV: a UI convenience only; the server enforces every pro gate with 402 pro_required
export function ProGate({ feature, detail, children }: { feature: string; detail: string; children: ReactNode }): JSX.Element {
  const pro = useIsPro();
  return pro ? <>{children}</> : <UpgradeNotice feature={feature} detail={detail} />;
}
