import type { JSX } from "react";
import { describeError, isApiError } from "../api.ts";
import { Button } from "./Button.tsx";

// O(1)
// INV: upstream and llm_bad_output offer a retry
export function ErrorBanner({ error, onRetry }: { error: unknown; onRetry?: () => void }): JSX.Element | null {
  if (error === null || error === undefined) return null;
  const code = isApiError(error) ? error.code : null;
  const retry = (code === "upstream" || code === "llm_bad_output") && onRetry;
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl border border-danger/50 bg-panel-2 px-4 py-3 text-sm text-danger">
      <span className="min-w-0 flex-1">{describeError(error)}</span>
      {retry && (
        <Button variant="danger" className="px-3 py-1.5" onClick={retry}>
          Retry
        </Button>
      )}
    </div>
  );
}
