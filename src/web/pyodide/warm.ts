import type { CodeSpec } from "../../shared/code.ts";
import { parseOut } from "./protocol.ts";

const live = new Set<Worker>();

type Phase = "booting" | "ready" | "failed" | "idle";

type Slot = {
  key: string;
  refs: number;
  phase: Phase;
  worker: Worker | null;
  indexURL: string;
  libs: readonly string[];
};

const slots = new Map<string, Slot>();

export type WarmStatus = "absent" | "booting" | "ready" | "failed" | "idle";

// O(1)
export function indexURLOf(given?: string): string {
  if (given !== undefined) return given.endsWith("/") ? given : `${given}/`;
  const origin = globalThis.location?.origin;
  if (!origin || origin === "null") throw new Error("Python failed to start.");
  return new URL("/pyodide/", origin).href;
}

// O(libs)
function warmKey(indexURL: string, libs: readonly string[]): string {
  return `${indexURL}\n${libs.join("\0")}`;
}

// O(1)
export function createPythonWorker(): Worker {
  const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  live.add(worker);
  return worker;
}

// O(1)
// INV: terminate() is how a worker leaves the live set. A stopped worker is not counted.
export function stopPythonWorker(worker: Worker): void {
  live.delete(worker);
  worker.terminate();
}

// O(1)
export function livePythonWorkers(): number {
  return live.size;
}

// O(n) in mounted questions
// INV: every warm worker is terminated and forgotten. A later mount starts from nothing.
export function resetWarmPool(): void {
  for (const slot of slots.values()) {
    const worker = slot.worker;
    slot.worker = null;
    if (worker) stopPythonWorker(worker);
  }
  slots.clear();
  for (const worker of [...live]) stopPythonWorker(worker);
}

// O(1)
function fail(slot: Slot, worker: Worker): void {
  if (slot.worker !== worker) return;
  slot.worker = null;
  slot.phase = "failed";
  stopPythonWorker(worker);
}

// O(1)
function start(slot: Slot): void {
  const worker = createPythonWorker();
  slot.worker = worker;
  slot.phase = "booting";
  worker.onmessage = (ev: MessageEvent<unknown>): void => {
    if (slot.worker !== worker) return;
    const msg = parseOut(ev.data);
    if (msg?.type === "booted") {
      slot.phase = "ready";
      return;
    }
    if (msg?.type === "error") fail(slot, worker);
  };
  worker.onerror = (): void => {
    fail(slot, worker);
  };
  worker.postMessage({ type: "boot", indexURL: slot.indexURL, libs: [...slot.libs] });
}

// O(1)
// INV: one warm worker per mounted library set. The last release terminates it, so none remains after unmount.
// SEC: the worker is sent only this question's libraries. It blocks network while booting, before any user code.
// INV: a page with no usable origin pre-warms nothing and never throws; Run then fails on the cold path with the error it always showed
export function prewarmPython(spec: CodeSpec, opts: { indexURL?: string } = {}): () => void {
  let indexURL: string;
  try {
    indexURL = indexURLOf(opts.indexURL);
  } catch {
    return () => undefined;
  }
  const libs = [...spec.libraries];
  const key = warmKey(indexURL, libs);
  let slot = slots.get(key);
  if (!slot) {
    slot = { key, refs: 0, phase: "idle", worker: null, indexURL, libs };
    slots.set(key, slot);
  }
  slot.refs += 1;
  if (slot.worker === null) start(slot);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    slot.refs -= 1;
    if (slot.refs > 0) return;
    const worker = slot.worker;
    slot.worker = null;
    slot.phase = "idle";
    slots.delete(key);
    if (worker) stopPythonWorker(worker);
  };
}

// O(1)
// INV: a warm worker is handed out once, and only when its index and libraries match this run.
export function claimWarm(indexURL: string, libs: readonly string[]): Worker | null {
  const slot = slots.get(warmKey(indexURL, libs));
  if (!slot?.worker) return null;
  if (slot.phase !== "booting" && slot.phase !== "ready") return null;
  const worker = slot.worker;
  slot.worker = null;
  slot.phase = "idle";
  worker.onmessage = null;
  worker.onerror = null;
  return worker;
}

// O(1)
// INV: after a run, a question that is still mounted gets a fresh worker. An unmounted question does not.
export function replenishWarm(indexURL: string, libs: readonly string[]): void {
  const slot = slots.get(warmKey(indexURL, libs));
  if (!slot || slot.refs <= 0 || slot.worker) return;
  start(slot);
}

// O(1)
export function warmStatus(indexURL: string, libs: readonly string[]): WarmStatus {
  const slot = slots.get(warmKey(indexURLOf(indexURL), libs));
  if (!slot) return "absent";
  if (slot.phase === "booting" || slot.phase === "ready" || slot.phase === "failed") return slot.phase;
  return slot.refs > 0 ? "idle" : "absent";
}
