import { createContext, useCallback, useContext, useEffect, useMemo, useState, type JSX, type ReactNode } from "react";
import { ConfigResponse } from "../shared/api.ts";
import { Season, SeasonResponse, seasonOf } from "../shared/season.ts";
import { Settings, type SettingsPatch } from "../shared/settings.ts";
import { api } from "./api.ts";

export type SessionState = {
  settings: Settings;
  config: ConfigResponse | null;
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
export function SessionProvider({ children }: { children: ReactNode }): JSX.Element {
  const [settings, setSettings] = useState<Settings>(() => Settings.parse({}));
  const [config, setConfig] = useState<ConfigResponse | null>(null);
  const [auto, setAuto] = useState<Season>(() => seasonOf(new Date().getUTCMonth(), "N"));

  const refresh = useCallback(async (): Promise<void> => {
    setSettings(await api("/api/settings", Settings));
  }, []);

  const updateSettings = useCallback(async (patch: SettingsPatch): Promise<Settings> => {
    const next = await api("/api/settings", Settings, { method: "PUT", body: patch });
    setSettings(next);
    return next;
  }, []);

  useEffect(() => {
    void refresh().catch(() => undefined);
    void api("/api/config", ConfigResponse).then(setConfig, () => undefined);
    void api("/api/season", SeasonResponse).then((r) => setAuto(r.season), () => undefined);
  }, [refresh]);

  const season = settings.season === "auto" ? auto : settings.season;
  useEffect(() => applySeason(season), [season]);

  const value = useMemo<SessionState>(() => ({ settings, config, season, refresh, updateSettings }), [settings, config, season, refresh, updateSettings]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

// O(1)
export function useSession(): SessionState {
  const s = useContext(SessionContext);
  if (!s) throw new Error("useSession outside SessionProvider");
  return s;
}

// O(1)
export function useSettings(): { settings: Settings; updateSettings: (patch: SettingsPatch) => Promise<Settings> } {
  const { settings, updateSettings } = useSession();
  return { settings, updateSettings };
}

// O(1)
export function useSeason(): Season {
  return useSession().season;
}
