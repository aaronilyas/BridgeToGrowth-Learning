import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// O(1)
export function appDataDir(): string {
  const override = process.env.BTG_DATA_DIR;
  const home = homedir();
  const path = override ?? (process.platform === "darwin"
    ? join(home, "Library", "Application Support", "BridgeToGrowth")
    : process.platform === "win32"
      ? join(process.env.APPDATA ?? join(home, "AppData", "Roaming"), "BridgeToGrowth")
      : join(process.env.XDG_DATA_HOME ?? join(home, ".local", "share"), "bridgetogrowth"));
  mkdirSync(path, { recursive: true, mode: 0o700 });
  return path;
}

// O(1)
export function databasePath(): string {
  return join(appDataDir(), "btg.sqlite");
}
