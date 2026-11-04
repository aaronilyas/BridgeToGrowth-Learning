import { randomBytes } from "node:crypto";
import Electrobun, { BrowserWindow, Utils } from "electrobun/main";
import { startServer } from "../src/server/boot.ts";
import { setExternalOpener } from "../src/server/external.ts";

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

setExternalOpener((url) => Utils.openExternal(url));
const token = randomBytes(32).toString("hex");
const server = await startServer({ token });
const appWindow = new BrowserWindow({
  title: "BridgeToGrowth Learning",
  url: server.url,
  preload: desktopPreload(token),
  renderer: "native",
  frame: { width: 1280, height: 840 },
});
const state = { stopping: false };
console.log(`BTG_URL=${server.url}`);
console.log("window created");
appWindow.on("close", () => void stopDesktopServer(server.stop, state));
Electrobun.events.on("before-quit", () => void stopDesktopServer(server.stop, state));
const shutdown = (): void => void stopDesktopServer(server.stop, state).finally(() => process.exit(0));
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
