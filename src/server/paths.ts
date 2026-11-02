import { chmodSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// O(1)
function platformBase(): string {
  if (process.platform === "win32") {
    const appData = process.env.APPDATA;
    if (!appData) throw new Error("app data directory unavailable");
    return appData;
  }
  if (process.platform === "darwin") return join(homedir(), "Library", "Application Support");
  const xdg = process.env.XDG_DATA_HOME;
  if (xdg && xdg.length > 0) return xdg;
  return join(homedir(), ".local", "share");
}

// O(1)
// SEC: the local app stores its data in a private per-user directory
export function appDataDir(): string {
  const override = process.env.BTG_DATA_DIR;
  const dir = override && override.length > 0 ? override : join(platformBase(), "BridgeToGrowthLearning");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") chmodSync(dir, 0o700);
  return dir;
}

// O(1)
export function databasePath(): string {
  return join(appDataDir(), "btg.sqlite");
}
