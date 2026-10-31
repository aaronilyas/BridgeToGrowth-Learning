import { createContext, useCallback, useContext, useEffect, useMemo, useState, type JSX, type ReactNode } from "react";
import { z } from "zod";
import { ConfigResponse, MeResponse, type PlanTerms } from "../shared/api.ts";
import { Season, SeasonResponse, seasonOf } from "../shared/season.ts";
import { Settings, type SettingsPatch } from "../shared/settings.ts";
import { api, isApiError } from "./api.ts";
import { resetAskJob } from "./askJob.ts";

export type Me = Omit<MeResponse, "settings"> & { settings: Settings };
export type SessionState = {
  me: Me | null | undefined;
  failed: boolean;
  config: ConfigResponse | null;
  season: Season;
  refresh: () => Promise<void>;
  updateSettings: (patch: SettingsPatch) => Promise<Settings>;
  signOut: () => Promise<void>;
};

const SessionContext = createContext<SessionState | null>(null);

// O(1)
// INV: the theme is one attribute on <html>; every colour and ornament switch is CSS keyed on it
function applySeason(s: Season): void {
  document.documentElement.dataset.season = s;
}

// O(1) per fetch
// INV: me is undefined while loading and null when signed out; failed is set when /api/me fails for any reason other than 401
export function SessionProvider({ children }: { children: ReactNode }): JSX.Element {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const [config, setConfig] = useState<ConfigResponse | null>(null);
  const [auto, setAuto] = useState<Season>(() => seasonOf(new Date().getUTCMonth(), "N"));

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const m = await api("/api/me", MeResponse);
      setMe({ ...m, settings: Settings.parse(m.settings) });
      setFailed(false);
    } catch (e) {
      setMe(null);
      setFailed(!(isApiError(e) && e.status === 401));
    }
  }, []);

  const updateSettings = useCallback(async (patch: SettingsPatch): Promise<Settings> => {
    const next = await api("/api/settings", Settings, { method: "PUT", body: patch });
    setMe((m) => (m ? { ...m, settings: next } : m));
    return next;
  }, []);

  const signOut = useCallback(async (): Promise<void> => {
    await api("/api/auth/logout", z.undefined(), { method: "POST" }).catch(() => undefined);
    resetAskJob();
    setMe(null);
  }, []);

  useEffect(() => {
    void refresh();
    void api("/api/config", ConfigResponse).then(setConfig, () => undefined);
    void api("/api/season", SeasonResponse).then((r) => setAuto(r.season), () => undefined);
  }, [refresh]);

  const pref = me?.settings.season ?? "auto";
  const season = pref === "auto" ? auto : pref;
  useEffect(() => applySeason(season), [season]);

  const value = useMemo<SessionState>(() => ({ me, failed, config, season, refresh, updateSettings, signOut }), [me, failed, config, season, refresh, updateSettings, signOut]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

// O(1)
export function useSession(): SessionState {
  const s = useContext(SessionContext);
  if (!s) throw new Error("useSession outside SessionProvider");
  return s;
}

// O(1)
// INV: only call inside the authenticated shell, where the guard guarantees me is loaded
export function useMe(): Me {
  const { me } = useSession();
  if (!me) throw new Error("useMe outside the auth guard");
  return me;
}

// O(1)
export function useIsPro(): boolean {
  return useMe().entitlement.plan === "pro";
}

// O(1)
// INV: null until /api/config loads
export function usePlanTerms(): PlanTerms | null {
  return useSession().config?.plans ?? null;
}

// O(1)
export function useSettings(): { settings: Settings; updateSettings: (patch: SettingsPatch) => Promise<Settings> } {
  const { updateSettings } = useSession();
  return { settings: useMe().settings, updateSettings };
}

// O(1)
export function useSeason(): Season {
  return useSession().season;
}
