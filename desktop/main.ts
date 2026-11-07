import "./linuxWebkit.ts";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import Electrobun, { BrowserWindow, Screen, Utils } from "electrobun/main";

type Boot = typeof import("../src/server/boot.ts");

// O(1)
// SEC: the preload value is inline JavaScript, never a URL, and the token stays out of logs
function desktopPreload(token: string): string {
  const literal = JSON.stringify(token);
  return `Object.defineProperty(globalThis, "__BTG_TOKEN__", { value: ${literal}, writable: false, enumerable: false, configurable: false });`;
}

// O(1)
// INV: the loopback backend stops exactly once when the window closes or the process is signalled
async function stopDesktopServer(stop: () => Promise<void>, state: { stopping: boolean }): Promise<void> {
  if (state.stopping) return;
  state.stopping = true;
  await stop();
}

// O(1)
// INV: Electrobun writes Resources/version.json beside bin/, and the launcher starts in bin/, so this runs before loadBoot changes the cwd; a missing or unreadable file means no channel, which the updater treats as a build it cannot install over
async function readReleaseChannel(): Promise<string> {
  try {
    const info: unknown = await Bun.file(join("..", "Resources", "version.json")).json();
    return typeof info === "object" && info !== null && "channel" in info && typeof info.channel === "string" ? info.channel : "";
  } catch {
    return "";
  }
}

// O(1)
// INV: the backend and renderer come from scripts/build.ts (copied to server/), not from this bundle, so the app runs the same split, Tailwind-processed bundle as production
// INV: Bun resolves a bundled HTML import's files against the cwd, and the launcher starts in bin/, so the cwd moves to the server bundle first
async function loadBoot(): Promise<Boot> {
  const dir = join(import.meta.dir, "server");
  process.chdir(dir);
  const mod: Boot = await import(join(dir, "boot.js"));
  return mod;
}

// O(1)
// INV: the window opens at about 80% × 88% of the primary monitor's work area, never below 1024×700 or above the work area; centred
// INV: if the display cannot be read (zero-sized work area), the window falls back to 1280×840
function initialFrame(work: { width: number; height: number }): { width: number; height: number } {
  if (!(work.width > 0 && work.height > 0)) return { width: 1280, height: 840 };
  const fit = (share: number, total: number, min: number): number => Math.round(Math.min(total, Math.max(min, total * share)));
  return { width: fit(0.8, work.width, 1024), height: fit(0.88, work.height, 700) };
}

const channel = await readReleaseChannel();
const { startServer } = await loadBoot();
const token = randomBytes(32).toString("hex");
const server = await startServer({
  token,
  openExternal: (url) => Utils.openExternal(url),
  shell: { channel, quit: () => void Utils.quit(), openPath: (path) => Utils.openPath(path), revealPath: (path) => void Utils.showItemInFolder(path) },
});
const appWindow = new BrowserWindow({
  title: "BridgeToGrowth Learning",
  url: server.url,
  preload: desktopPreload(token),
  renderer: "native",
  frame: initialFrame(Screen.getPrimaryDisplay().workArea),
});
const state = { stopping: false };
console.log(`BTG_URL=${server.url}`);
console.log("window created");
appWindow.on("close", () => void stopDesktopServer(server.stop, state));
Electrobun.events.on("before-quit", () => void stopDesktopServer(server.stop, state));
const shutdown = (): void => void stopDesktopServer(server.stop, state).finally(() => process.exit(0));
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
