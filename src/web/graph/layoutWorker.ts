import { layoutGraph, type LayoutEdge, type LayoutNode } from "./layout.ts";

// O(1)
function isNode(v: unknown): v is LayoutNode {
  if (typeof v !== "object" || v === null) return false;
  const n = v as { id?: unknown; domain?: unknown; attempts?: unknown };
  return typeof n.id === "string" && typeof n.domain === "string" && typeof n.attempts === "number";
}

// O(1)
function isEdge(v: unknown): v is LayoutEdge {
  if (typeof v !== "object" || v === null) return false;
  const e = v as { src?: unknown; dst?: unknown };
  return typeof e.src === "string" && typeof e.dst === "string";
}

// O(ticks·(V+E) log V)
// INV: the worker only runs layoutGraph; a bad payload is an error reply, not a throw on the page
function onMessage(ev: MessageEvent<unknown>): void {
  const data = ev.data;
  if (typeof data !== "object" || data === null) return;
  const rec = data as { id?: unknown; nodes?: unknown; edges?: unknown };
  if (typeof rec.id !== "number" || !Array.isArray(rec.nodes) || !Array.isArray(rec.edges)) return;
  if (!rec.nodes.every(isNode) || !rec.edges.every(isEdge)) {
    postMessage({ id: rec.id, error: "invalid layout input" });
    return;
  }
  try {
    postMessage({ id: rec.id, pos: layoutGraph(rec.nodes, rec.edges) });
  } catch (e) {
    postMessage({ id: rec.id, error: e instanceof Error ? e.message : "layout failed" });
  }
}

self.onmessage = onMessage;
