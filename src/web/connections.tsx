import { createContext, useCallback, useContext, useEffect, useMemo, useState, type JSX, type ReactNode } from "react";
import { ProvidersResponse, type ProvidersResponse as ProviderRows } from "../shared/api.ts";
import { api, describeError } from "./api.ts";

export type ConnectionsState = {
  statuses: ProviderRows;
  ready: boolean;
  connected: boolean;
  error: string;
  refresh: () => Promise<void>;
};

const ConnectionsContext = createContext<ConnectionsState | null>(null);

// O(1) per fetch
export function ConnectionsProvider({ children }: { children: ReactNode }): JSX.Element {
  const [statuses, setStatuses] = useState<ProviderRows>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async (): Promise<void> => {
    try {
      setStatuses(await api("/api/providers", ProvidersResponse));
      setError("");
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const connected = statuses.some((status) => status.connected);
  const value = useMemo<ConnectionsState>(() => ({ statuses, ready, connected, error, refresh }), [statuses, ready, connected, error, refresh]);
  return <ConnectionsContext.Provider value={value}>{children}</ConnectionsContext.Provider>;
}

// O(1)
export function useConnections(): ConnectionsState {
  const value = useContext(ConnectionsContext);
  if (!value) throw new Error("useConnections outside ConnectionsProvider");
  return value;
}
