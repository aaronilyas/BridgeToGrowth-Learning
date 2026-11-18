import { layoutGraph, layoutKey, type LayoutEdge, type LayoutNode, type Point } from "./layout.ts";
// @ts-expect-error bun file URL; production replaces this with the bundled worker asset
import layoutWorkerAsset from "./layoutWorker.ts" with { type: "file" };

export const LAYOUT_CACHE_CAP = 8;

type Job = {
  key: string;
  nodes: readonly LayoutNode[];
  edges: readonly LayoutEdge[];
  live: boolean;
  onDone: (pos: Point[]) => void;
};

const cache = new Map<string, Point[]>();
const pending = new Map<number, Job>();

let worker: Worker | null = null;
let nextId = 1;

// O(1)
export function cachedLayout(key: string): Point[] | undefined {
  const hit = cache.get(key);
  if (!hit) return undefined;
  cache.delete(key);
  cache.set(key, hit);
  return hit;
}

// O(1)
// INV: at most LAYOUT_CACHE_CAP entries; the oldest insertion is dropped
export function rememberLayout(key: string, pos: Point[]): void {
  cache.delete(key);
  cache.set(key, pos);
  while (cache.size > LAYOUT_CACHE_CAP) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

// O(1)
// INV: the session cache and the worker are both gone; a later request starts from nothing
export function resetLayoutClient(): void {
  cache.clear();
  stopWorker();
  nextId = 1;
}

// O(1)
export function liveLayoutWorkers(): number {
  return worker ? 1 : 0;
}

// O(1)
// INV: terminate() is how the layout worker leaves liveLayoutWorkers
function stopWorker(): void {
  pending.clear();
  const w = worker;
  worker = null;
  if (!w) return;
  w.onmessage = null;
  w.onerror = null;
  w.terminate();
}

// O(1)
function maybeStop(): void {
  if (pending.size === 0) stopWorker();
}

// O(ticks·(V+E) log V)
function computeMain(nodes: readonly LayoutNode[], edges: readonly LayoutEdge[], key: string, onDone: (pos: Point[]) => void): void {
  const pos = layoutGraph(nodes, edges);
  rememberLayout(key, pos);
  onDone(pos);
}

// O(1)
function isPoint(v: unknown): v is Point {
  if (typeof v !== "object" || v === null) return false;
  const p = v as { x?: unknown; y?: unknown };
  return typeof p.x === "number" && typeof p.y === "number" && Number.isFinite(p.x) && Number.isFinite(p.y);
}

// O(n) in pos length
function parseReply(v: unknown): { id: number; pos: Point[] } | { id: number; error: true } | null {
  if (typeof v !== "object" || v === null) return null;
  const rec = v as { id?: unknown; pos?: unknown; error?: unknown };
  if (typeof rec.id !== "number") return null;
  if (typeof rec.error === "string") return { id: rec.id, error: true };
  if (!Array.isArray(rec.pos) || !rec.pos.every(isPoint)) return null;
  return { id: rec.id, pos: rec.pos };
}

// O(n) in pos length
function onMessage(ev: MessageEvent<unknown>): void {
  const reply = parseReply(ev.data);
  if (!reply) return;
  const job = pending.get(reply.id);
  pending.delete(reply.id);
  if (!job) {
    maybeStop();
    return;
  }
  if ("error" in reply) {
    if (job.live) computeMain(job.nodes, job.edges, job.key, job.onDone);
    maybeStop();
    return;
  }
  rememberLayout(job.key, reply.pos);
  if (job.live) job.onDone(reply.pos);
  maybeStop();
}

// O(pending · layout)
// INV: a failed worker still yields layoutGraph positions on the main thread for every live job
function onError(): void {
  const jobs = [...pending.values()];
  pending.clear();
  stopWorker();
  for (const job of jobs) {
    if (job.live) computeMain(job.nodes, job.edges, job.key, job.onDone);
  }
}

// O(1)
// SEC: the worker URL is a same-origin module entry (CSP script-src 'self'); no blob: worker
// INV: production loads the hashed file the HTML bundle serves; bun --hot and tests load the TypeScript module
function layoutWorkerSpec(): string | URL {
  if (process.env.NODE_ENV === "production") return layoutWorkerAsset;
  return new URL("./layoutWorker.ts", import.meta.url);
}

// O(1)
// SEC: the worker URL is a same-origin module entry (CSP script-src 'self'); no blob: worker
function getWorker(): Worker | null {
  if (worker) return worker;
  if (typeof Worker !== "function") return null;
  try {
    const w = new Worker(layoutWorkerSpec(), { type: "module" });
    w.onmessage = onMessage;
    w.onerror = onError;
    worker = w;
    return w;
  } catch {
    return null;
  }
}

// O(V+E) on a cache hit or when falling back; the force ticks run in the worker when one exists
// INV: a cancelled job never calls onDone; a reply whose id is not pending is ignored
// INV: missing Worker, constructor failure, postMessage failure, or worker error still produce layoutGraph's positions
export function requestLayout(nodes: readonly LayoutNode[], edges: readonly LayoutEdge[], onDone: (pos: Point[]) => void): () => void {
  const key = layoutKey(nodes, edges);
  const hit = cachedLayout(key);
  if (hit) {
    onDone(hit);
    return () => undefined;
  }
  const w = getWorker();
  if (!w) {
    computeMain(nodes, edges, key, onDone);
    return () => undefined;
  }
  const id = nextId++;
  const job: Job = { key, nodes, edges, live: true, onDone };
  pending.set(id, job);
  try {
    w.postMessage({ id, nodes, edges });
  } catch {
    pending.delete(id);
    if (job.live) computeMain(nodes, edges, key, onDone);
    maybeStop();
    return () => {
      job.live = false;
    };
  }
  return () => {
    job.live = false;
    pending.delete(id);
    maybeStop();
  };
}
