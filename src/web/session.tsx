import { createContext, useCallback, useContext, useEffect, useMemo, useState, type JSX, type ReactNode } from "react";
import { z } from "zod";
import { MeResponse } from "../shared/api.ts";
import { Season, SeasonResponse, seasonOf } from "../shared/season.ts";
import { Settings, type SettingsPatch } from "../shared/settings.ts";
import { api, isApiError } from "./api.ts";

export type Me = Omit<MeResponse, "settings"> & { settings: Settings };
export type SessionState = {
  me: Me | null | undefined;
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
// INV: me is undefined while loading, null when signed out
export function SessionProvider({ children }: { children: ReactNode }): JSX.Element {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [auto, setAuto] = useState<Season>(() => seasonOf(new Date().getUTCMonth(), "N"));

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const m = await api("/api/me", MeResponse);
      setMe({ ...m, settings: Settings.parse(m.settings) });
    } catch (e) {
      if (isApiError(e) && e.status === 401) setMe(null);
      else throw e;
    }
  }, []);

  const updateSettings = useCallback(async (patch: SettingsPatch): Promise<Settings> => {
    const next = await api("/api/settings", Settings, { method: "PUT", body: patch });
    setMe((m) => (m ? { ...m, settings: next } : m));
    return next;
  }, []);

  const signOut = useCallback(async (): Promise<void> => {
    await api("/api/auth/logout", z.undefined(), { method: "POST" });
    setMe(null);
  }, []);

  useEffect(() => {
    void refresh().catch(() => setMe(null));
    void api("/api/season", SeasonResponse).then((r) => setAuto(r.season), () => undefined);
  }, [refresh]);

  const pref = me?.settings.season ?? "auto";
  const season = pref === "auto" ? auto : pref;
  useEffect(() => applySeason(season), [season]);

  const value = useMemo<SessionState>(() => ({ me, season, refresh, updateSettings, signOut }), [me, season, refresh, updateSettings, signOut]);
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
export function useSettings(): { settings: Settings; updateSettings: (patch: SettingsPatch) => Promise<Settings> } {
  const { updateSettings } = useSession();
  return { settings: useMe().settings, updateSettings };
}

// O(1)
export function useSeason(): Season {
  return useSession().season;
}
