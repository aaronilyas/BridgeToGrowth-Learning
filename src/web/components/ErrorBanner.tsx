import { useEffect, useState, type JSX } from "react";
import { Link, useLocation } from "wouter";
import { describeError, isApiError } from "../api.ts";
import { Button } from "./Button.tsx";

// O(1)
// INV: quota_exceeded links /usage, payment_required navigates to /billing, upstream and llm_bad_output offer a retry
export function ErrorBanner({ error, onRetry }: { error: unknown; onRetry?: () => void }): JSX.Element | null {
  const [, navigate] = useLocation();
  const code = isApiError(error) ? error.code : null;
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    if (code === "payment_required") navigate("/billing");
  }, [code, navigate]);
  if (error === null || error === undefined) return null;
  if (code === "quota_exceeded" && dismissed) return null;
  const retry = (code === "upstream" || code === "llm_bad_output") && onRetry;
  const now = new Date();
  const reset = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toLocaleDateString(undefined, { timeZone: "UTC" });
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl border border-danger/50 bg-panel-2 px-4 py-3 text-sm text-danger">
      <span className="min-w-0 flex-1">{code === "quota_exceeded" ? `Monthly AI limit reached — resets ${reset}` : describeError(error)}</span>
      {code === "quota_exceeded" && (
        <Link href="/usage" className="font-semibold underline">
          View usage
        </Link>
      )}
      {code === "quota_exceeded" && <button type="button" aria-label="Dismiss usage limit message" className="px-2 text-lg" onClick={() => setDismissed(true)}>×</button>}
      {retry && (
        <Button variant="danger" className="px-3 py-1.5" onClick={retry}>
          Retry
        </Button>
      )}
    </div>
  );
}
