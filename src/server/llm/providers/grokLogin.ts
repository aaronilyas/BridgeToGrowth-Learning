import type { LoginMethod, LoginState } from "../../../shared/providers.ts";
import { findCliBin } from "./codexLogin.ts";

type GrokLoginRun = { state: LoginState["state"]; method: LoginMethod; url: string | null; code: string | null; proc: Bun.Subprocess | null };

const LOGIN_DEADLINE_MS = 16 * 60 * 1000;
const OUTPUT_CAP = 16 * 1024;
const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g;
const AUTH_URL = /https:\/\/(?:accounts|auth)\.x\.ai\/[^\s"'<>]+/;
const DEVICE_CODE = /\b[A-Z0-9]{4}-[A-Z0-9]{4,6}\b/;

let grokLogin: GrokLoginRun = { state: "idle", method: "device", url: null, code: null, proc: null };
const listeners = new Set<() => void>();

// O(d) in searched directories
export function findGrokBin(): string | null {
  return findCliBin("grok");
}

// O(1)
// INV: the adapter drops its cached status whenever a sign-in finishes or is cancelled
export function onGrokLoginChange(listener: () => void): void {
  listeners.add(listener);
}

// O(1)
function notifyGrokLogin(): void {
  for (const listener of listeners) listener();
}

// O(n) in text length
// SEC: only an https://accounts.x.ai/ or https://auth.x.ai/ link printed by the official CLI is ever surfaced or opened
export function parseGrokLoginText(raw: string): { url: string | null; code: string | null } {
  const text = raw.replace(ANSI, "");
  const url = AUTH_URL.exec(text)?.[0] ?? null;
  const marker = text.search(/confirm this code/i);
  const code = marker < 0 ? null : (DEVICE_CODE.exec(text.slice(marker))?.[0] ?? null);
  return { url, code };
}

// O(n) in CLI output
async function watchGrokLoginOutput(proc: Bun.Subprocess<"ignore", "pipe", "pipe">): Promise<void> {
  const decoder = new TextDecoder();
  let text = "";
  const pump = async (stream: ReadableStream<Uint8Array>): Promise<void> => {
    const reader = stream.getReader();
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) return;
        text = (text + decoder.decode(chunk.value, { stream: true })).slice(-OUTPUT_CAP);
        const found = parseGrokLoginText(text);
        if (grokLogin.proc !== proc) return;
        grokLogin = { ...grokLogin, url: found.url ?? grokLogin.url, code: found.code ?? grokLogin.code };
      }
    } catch {
      return;
    }
  };
  await Promise.all([pump(proc.stdout), pump(proc.stderr)]);
}

// O(1)
// SEC: sign-in runs entirely inside the user's official grok CLI on xAI's own pages; this process never sees or stores a token and never reads ~/.grok
export function beginGrokLogin(method: LoginMethod, find: () => string | null = findGrokBin): void {
  if (grokLogin.state === "pending") return;
  const bin = find();
  if (bin === null) {
    grokLogin = { state: "failed", method, url: null, code: null, proc: null };
    return;
  }
  const argv = method === "device" ? [bin, "login", "--device-auth"] : [bin, "login", "--oauth"];
  const proc = Bun.spawn(argv, { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  grokLogin = { state: "pending", method, url: null, code: null, proc };
  void watchGrokLoginOutput(proc);
  const deadline = setTimeout(() => proc.kill(), LOGIN_DEADLINE_MS);
  void proc.exited.then((code) => {
    clearTimeout(deadline);
    if (grokLogin.proc !== proc) return;
    grokLogin = { state: code === 0 ? "ok" : "failed", method, url: null, code: null, proc: null };
    notifyGrokLogin();
  });
}

// O(1)
export function cancelGrokLogin(): void {
  const proc = grokLogin.proc;
  grokLogin = { state: "idle", method: grokLogin.method, url: null, code: null, proc: null };
  if (proc !== null) proc.kill();
  notifyGrokLogin();
}

// O(1)
export function readGrokLogin(): LoginState {
  const base: LoginState = { state: grokLogin.state, method: grokLogin.method };
  if (grokLogin.state !== "pending") return base;
  return { ...base, ...(grokLogin.url === null ? {} : { url: grokLogin.url }), ...(grokLogin.code === null ? {} : { code: grokLogin.code }) };
}

// O(1)
export function pendingGrokLoginUrl(): string | null {
  return grokLogin.state === "pending" ? grokLogin.url : null;
}

// O(1)
// SEC: sign-out is the official CLI's own `grok logout`; this process never deletes files under ~/.grok itself
export async function signOutGrok(find: () => string | null = findGrokBin): Promise<boolean> {
  cancelGrokLogin();
  const bin = find();
  if (bin === null) return false;
  const proc = Bun.spawn([bin, "logout"], { stdin: "ignore", stdout: "ignore", stderr: "ignore" });
  const ok = (await proc.exited) === 0;
  notifyGrokLogin();
  return ok;
}
