import { createContext, useCallback, useContext, useEffect, useMemo, useState, type JSX, type ReactNode } from "react";
import { ProvidersResponse, type ProvidersResponse as ProviderRows } from "../shared/api.ts";
import { api, describeError } from "./api.ts";

export type Gate = "loading" | "app" | "first-run";

export type ConnectionsState = {
  statuses: ProviderRows;
  ready: boolean;
  connected: boolean;
  gate: Gate;
  error: string;
  refresh: () => Promise<void>;
};

const ConnectionsContext = createContext<ConnectionsState | null>(null);
const KNOWN_KEY = "btg:connected";

// O(1)
// INV: true only if the last finished check on this device found a connected provider; storage errors read as false
export function readKnownConnected(): boolean {
  try {
    return localStorage.getItem(KNOWN_KEY) === "1";
  } catch {
    return false;
  }
}

// O(1)
function writeKnownConnected(connected: boolean): void {
  try {
    localStorage.setItem(KNOWN_KEY, connected ? "1" : "0");
  } catch {
    // a device without storage waits for the check every launch
  }
}

// O(1)
// INV: a check that answered decides; until then (or if it failed) the last answer on this device decides, and with none the app waits. Only a check that answered with nothing connected opens first run, never a slow or failed one when this device was connected before
export function gateOf(s: { answered: boolean; connected: boolean; failed: boolean; known: boolean }): Gate {
  if (s.answered) return s.connected ? "app" : "first-run";
  if (s.known) return "app";
  return s.failed ? "first-run" : "loading";
}

// O(1) per fetch
// INV: ready means a check finished (answered or failed); ConnectionCards waits on it. gate is what the router shows, and may open the app before ready
export function ConnectionsProvider({ children }: { children: ReactNode }): JSX.Element {
  const [statuses, setStatuses] = useState<ProviderRows>([]);
  const [ready, setReady] = useState(false);
  const [answered, setAnswered] = useState(false);
  const [known] = useState(readKnownConnected);
  const [error, setError] = useState("");

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const rows = await api("/api/providers", ProvidersResponse);
      setStatuses(rows);
      setAnswered(true);
      writeKnownConnected(rows.some((status) => status.connected));
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
  const gate = gateOf({ answered, connected, failed: ready && !answered, known });
  const value = useMemo<ConnectionsState>(() => ({ statuses, ready, connected, gate, error, refresh }), [statuses, ready, connected, gate, error, refresh]);
  return <ConnectionsContext.Provider value={value}>{children}</ConnectionsContext.Provider>;
}

// O(1)
export function useConnections(): ConnectionsState {
  const value = useContext(ConnectionsContext);
  if (!value) throw new Error("useConnections outside ConnectionsProvider");
  return value;
}
