import { useCallback, type JSX } from "react";
import { Button } from "../Button.tsx";
import { Spinner } from "../Spinner.tsx";
import { useConnections } from "../../connections.tsx";
import { useSession } from "../../session.tsx";
import { ProviderCard } from "./ProviderCard.tsx";

// O(1) per status refresh
export function ConnectionCards({ onChanged }: { onChanged?: () => Promise<void> } = {}): JSX.Element {
  const { statuses, ready, error, refresh } = useConnections();
  const { refresh: refreshSettings } = useSession();
  const changed = useCallback(async (): Promise<void> => {
    await refresh();
    await refreshSettings();
    if (onChanged) await onChanged();
  }, [onChanged, refresh, refreshSettings]);

  if (!ready) return <Spinner label="Checking connections…" />;
  return (
    <div className="grid gap-4">
      {error && (
        <div className="flex flex-wrap items-center gap-3" role="alert">
          <p className="text-sm text-danger">{error}</p>
          <Button variant="ghost" onClick={() => void refresh()}>Retry</Button>
        </div>
      )}
      {statuses.map((status) => <ProviderCard key={status.provider} status={status} onChanged={changed} />)}
    </div>
  );
}
