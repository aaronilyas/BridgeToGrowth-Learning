import React, { createContext, useContext, useEffect, useState, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { focusManager, onlineManager, QueryClientProvider } from '@tanstack/react-query';
import { Runtime } from './runtime';
const Context = createContext<Runtime | null>(null);
const Lifecycle = createContext({ online: false, active: true });
export function Provider({ runtime, children }: React.PropsWithChildren<{ runtime: Runtime }>) {
  const [online, setOnline] = useState(false), [active, setActive] = useState(AppState.currentState === 'active');
  useEffect(() => {
    runtime.http.setOnline(false);
    let started = false;
    const connection = NetInfo.addEventListener(state => {
      const connected = state.isConnected === true && state.isInternetReachable !== false;
      runtime.http.setOnline(connected); onlineManager.setOnline(connected); setOnline(connected);
      if (!started) { started = true; void runtime.session.restore(); }
    });
    const app = AppState.addEventListener('change', state => { const foreground = state === 'active'; setActive(foreground); focusManager.setFocused(foreground); });
    return () => { connection(); app.remove(); };
  }, [runtime]);
  return <Context.Provider value={runtime}><Lifecycle.Provider value={{ online, active }}><QueryClientProvider client={runtime.queryClient}>{children}</QueryClientProvider></Lifecycle.Provider></Context.Provider>;
}
export function useRuntime() { const runtime = useContext(Context); if (!runtime) throw new Error('Runtime provider missing'); return runtime; }
export function useSession() { const { session } = useRuntime(); return useSyncExternalStore(session.subscribe, session.snapshot, session.snapshot); }
export const useLifecycle = () => useContext(Lifecycle);
export function usePending() { const { lessons } = useRuntime(); useSyncExternalStore(lessons.subscribe, lessons.snapshot, lessons.snapshot); return lessons; }
