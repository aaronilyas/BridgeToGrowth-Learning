import { readFileSync, writeFileSync } from "node:fs";

// The desktop window's origin is http://127.0.0.1:<port>. The WebView keys its HTTP cache, JS/wasm code caches and
// localStorage by origin, so a port that changes every launch throws all of them away. This module keeps one port.

const FIRST_PICK_MIN = 20_000;
const FIRST_PICK_SPAN = 10_000;

// O(1)
// INV: only an integer in 1024..65535 counts as a saved port; anything else (missing file, junk, a privileged port) reads as none
export function readSavedPort(file: string): number | null {
  let raw: string;
  try {
    raw = readFileSync(file, "utf8").trim();
  } catch {
    return null;
  }
  if (!/^\d{4,5}$/.test(raw)) return null;
  const port = Number(raw);
  return port >= 1024 && port <= 65_535 ? port : null;
}

// O(1)
// INV: a failed write is ignored; the next launch then picks again, which costs that launch its caches and nothing else
export function savePort(file: string, port: number): void {
  try {
    writeFileSync(file, `${port}\n`, { mode: 0o600 });
  } catch {
    // keep running on the port already bound
  }
}

// O(1)
// INV: a first pick comes from 20000..29999, below both the Linux (32768+) and Windows (49152+) ephemeral ranges, so an outgoing connection is unlikely to be holding it on a later launch
export function firstPickPort(random: () => number = Math.random): number {
  return FIRST_PICK_MIN + Math.floor(random() * FIRST_PICK_SPAN);
}

// O(1) binds
// INV: tries the saved port, else a first pick; if that bind throws (port held by another process, or reserved by the OS) it binds port 0 and the kernel chooses. Returns the listener and whether the bound port differs from the saved one (so the caller saves it)
// SEC: a bind either succeeds on this process's own socket or throws; the window is only ever pointed at the port this process bound, never at the saved number, so a process squatting on the saved port is never loaded and only costs this launch its caches
export function bindStable<T extends { port: number | undefined }>(saved: number | null, bind: (port: number) => T, random: () => number = Math.random): { server: T; changed: boolean } {
  const want = saved ?? firstPickPort(random);
  let server: T;
  try {
    server = bind(want);
  } catch {
    server = bind(0);
  }
  return { server, changed: server.port !== saved };
}
