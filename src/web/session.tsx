import { createContext, useCallback, useContext, useEffect, useMemo, useState, type JSX, type ReactNode } from "react";
import { MeResponse } from "../shared/api.ts";
import { Season, SeasonResponse, seasonOf } from "../shared/season.ts";
import { Settings, type SettingsPatch } from "../shared/settings.ts";
import { api } from "./api.ts";

export type Me = Omit<MeResponse, "settings"> & { settings: Settings };
export type SessionState = {
  me: Me | null | undefined;
  season: Season;
  refresh: () => Promise<void>;
  updateSettings: (patch: SettingsPatch) => Promise<Settings>;
};

const SessionContext = createContext<SessionState | null>(null);

// O(1)
// INV: the theme is one attribute on <html>; every colour and ornament switch is CSS keyed on it
function applySeason(s: Season): void {
  document.documentElement.dataset.season = s;
}

// O(1) per fetch
// INV: me is undefined while loading, null when the local profile cannot be loaded
export function SessionProvider({ children }: { children: ReactNode }): JSX.Element {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [auto, setAuto] = useState<Season>(() => seasonOf(new Date().getUTCMonth(), "N"));

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const m = await api("/api/me", MeResponse);
      setMe({ ...m, settings: Settings.parse(m.settings) });
    } catch {
      setMe(null);
    }
  }, []);

  const updateSettings = useCallback(async (patch: SettingsPatch): Promise<Settings> => {
    const next = await api("/api/settings", Settings, { method: "PUT", body: patch });
    setMe((m) => (m ? { ...m, settings: next } : m));
    return next;
  }, []);

  useEffect(() => {
    void refresh();
    void api("/api/season", SeasonResponse).then((r) => setAuto(r.season), () => undefined);
  }, [refresh]);

  const pref = me?.settings.season ?? "auto";
  const season = pref === "auto" ? auto : pref;
  useEffect(() => applySeason(season), [season]);

  const value = useMemo<SessionState>(() => ({ me, season, refresh, updateSettings }), [me, season, refresh, updateSettings]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

// O(1)
export function useSession(): SessionState {
  const s = useContext(SessionContext);
  if (!s) throw new Error("useSession outside SessionProvider");
  return s;
}

// O(1)
// INV: only call inside the shell, where the guard guarantees me is loaded
export function useMe(): Me {
  const { me } = useSession();
  if (!me) throw new Error("useMe outside the shell");
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
