import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import type { LoginMethod, LoginState } from "../../../shared/providers.ts";

type LoginRun = { state: LoginState["state"]; method: LoginMethod; url: string | null; code: string | null; proc: Bun.Subprocess | null };

const LOGIN_DEADLINE_MS = 16 * 60 * 1000;
const OUTPUT_CAP = 16 * 1024;
const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g;
const AUTH_URL = /https:\/\/auth\.openai\.com\/[^\s"'<>]+/;
const DEVICE_CODE = /\b[A-Z0-9]{4}-[A-Z0-9]{4,6}\b/;

let login: LoginRun = { state: "idle", method: "device", url: null, code: null, proc: null };

// O(1)
function extraBinDirs(): string[] {
  const home = homedir();
  if (process.platform === "win32") {
    const appData = process.env.APPDATA ?? join(home, "AppData", "Roaming");
    const local = process.env.LOCALAPPDATA ?? join(home, "AppData", "Local");
    return [join(appData, "npm"), join(home, ".bun", "bin"), join(local, "mise", "shims"), join(home, ".volta", "bin")];
  }
  return [
    join(home, ".local", "bin"),
    join(home, ".npm-global", "bin"),
    join(home, ".bun", "bin"),
    join(home, ".local", "share", "mise", "shims"),
    join(home, ".volta", "bin"),
    join(home, ".cargo", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
  ];
}

// O(d) in searched directories
// INV: a window opened from a desktop launcher often has a minimal PATH, so the usual per-user install dirs are searched too
export function findCodexBin(): string | null {
  const found = Bun.which("codex");
  if (found !== null) return found;
  const path = [process.env.PATH ?? "", ...extraBinDirs()].filter((part) => part !== "").join(delimiter);
  return Bun.which("codex", { PATH: path });
}

// O(n) in text length
// SEC: only an https://auth.openai.com/ link printed by the official CLI is ever surfaced or opened
export function parseCodexLoginText(raw: string): { url: string | null; code: string | null } {
  const text = raw.replace(ANSI, "");
  const url = AUTH_URL.exec(text)?.[0] ?? null;
  const marker = text.search(/one-time code/i);
  const code = marker < 0 ? null : (DEVICE_CODE.exec(text.slice(marker))?.[0] ?? null);
  return { url, code };
}

// O(n) in CLI output
async function watchLoginOutput(proc: Bun.Subprocess<"ignore", "pipe", "ignore">): Promise<void> {
  const reader = proc.stdout.getReader();
  const decoder = new TextDecoder();
  let text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      text = (text + decoder.decode(chunk.value, { stream: true })).slice(-OUTPUT_CAP);
      const found = parseCodexLoginText(text);
      if (login.proc !== proc) return;
      login = { ...login, url: found.url ?? login.url, code: found.code ?? login.code };
    }
  } catch {
    return;
  }
}

// O(1)
// SEC: sign-in runs entirely inside the user's official Codex CLI on OpenAI's own pages; this process never sees or stores a token and never reads ~/.codex
// INV: starting a login makes the CLI discard any saved session, so callers only start one while Codex reports logged out
export function beginCodexLogin(method: LoginMethod, find: () => string | null = findCodexBin): void {
  if (login.state === "pending") return;
  const bin = find();
  if (bin === null) {
    login = { state: "failed", method, url: null, code: null, proc: null };
    return;
  }
  const argv = method === "device" ? [bin, "login", "--device-auth"] : [bin, "login"];
  const proc = Bun.spawn(argv, { stdin: "ignore", stdout: "pipe", stderr: "ignore" });
  login = { state: "pending", method, url: null, code: null, proc };
  void watchLoginOutput(proc);
  const deadline = setTimeout(() => proc.kill(), LOGIN_DEADLINE_MS);
  void proc.exited.then((code) => {
    clearTimeout(deadline);
    if (login.proc !== proc) return;
    login = { state: code === 0 ? "ok" : "failed", method, url: null, code: null, proc: null };
  });
}

// O(1)
export function cancelCodexLogin(): void {
  const proc = login.proc;
  login = { state: "idle", method: login.method, url: null, code: null, proc: null };
  if (proc !== null) proc.kill();
}

// O(1)
export function readCodexLogin(): LoginState {
  const base: LoginState = { state: login.state, method: login.method };
  if (login.state !== "pending") return base;
  return { ...base, ...(login.url === null ? {} : { url: login.url }), ...(login.code === null ? {} : { code: login.code }) };
}

// O(1)
export function pendingCodexLoginUrl(): string | null {
  return login.state === "pending" ? login.url : null;
}

// O(1)
// SEC: sign-out is the official CLI's own `codex logout`; this process never deletes files under ~/.codex itself
export async function signOutCodex(find: () => string | null = findCodexBin): Promise<boolean> {
  cancelCodexLogin();
  const bin = find();
  if (bin === null) return false;
  const proc = Bun.spawn([bin, "logout"], { stdin: "ignore", stdout: "ignore", stderr: "ignore" });
  return (await proc.exited) === 0;
}
