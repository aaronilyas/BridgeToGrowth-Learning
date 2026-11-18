import { afterEach, expect, test } from "bun:test";
import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { GraphResponse } from "../../shared/api.ts";
import { installTestDom } from "../testDom.ts";
import { liveLayoutWorkers, rememberLayout, resetLayoutClient } from "./layoutClient.ts";
import { layoutKey } from "./layout.ts";
import { GraphView } from "./GraphView.tsx";

const graph: GraphResponse = {
  nodes: [
    { id: "11111111-1111-1111-1111-111111111111", name: "Algebra", domain: "math", mastery: 0.5, attempts: 4, lastSeenAt: null },
    { id: "22222222-2222-2222-2222-222222222222", name: "Forces", domain: "physics", mastery: 0.2, attempts: 1, lastSeenAt: null },
  ],
  edges: [{ src: "11111111-1111-1111-1111-111111111111", dst: "22222222-2222-2222-2222-222222222222", kind: "prereq" }],
};

type Posted = { id?: number };

class FakeWorker {
  static all: FakeWorker[] = [];
  terminated = false;
  onmessage: ((ev: MessageEvent<unknown>) => void) | null = null;
  onerror: ((ev: ErrorEvent) => void) | null = null;
  messages: Posted[] = [];
  constructor(_url: string | URL, _opts?: WorkerOptions) {
    FakeWorker.all.push(this);
  }
  postMessage(data: Posted): void {
    this.messages.push(data);
  }
  terminate(): void {
    this.terminated = true;
  }
  emit(data: unknown): void {
    this.onmessage?.({ data } as MessageEvent<unknown>);
  }
}

const RealWorker = globalThis.Worker;

class FakeResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

const emptyRect = { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, toJSON() {} };

// O(1)
function mountDom(): HTMLElement {
  const host = installTestDom();
  HTMLElement.prototype.getBoundingClientRect = () => emptyRect as DOMRect;
  if (typeof globalThis.ResizeObserver !== "function") {
    globalThis.ResizeObserver = FakeResizeObserver as unknown as typeof ResizeObserver;
  }
  return host;
}

function asKids(n: object): object[] {
  const kids = (n as { childNodes?: ArrayLike<object> }).childNodes;
  return kids ? Array.from(kids) : [];
}

// O(n)
function textOf(node: object | null): string {
  if (!node) return "";
  const kids = asKids(node);
  if (kids.length === 0) return (node as { textContent?: string }).textContent ?? "";
  return kids.map((k) => textOf(k)).join("");
}

// O(n)
function findStatus(host: HTMLElement): string | null {
  const walk = (n: object): string | null => {
    const getAttribute = (n as { getAttribute?: (name: string) => string | null }).getAttribute;
    if (getAttribute?.("role") === "status") return textOf(n);
    for (const kid of asKids(n)) {
      const hit = walk(kid);
      if (hit !== null) return hit;
    }
    return null;
  };
  return walk(host);
}

// O(n)
function findSvg(host: HTMLElement): boolean {
  const walk = (n: object): boolean => {
    if ((n as { tagName?: string }).tagName === "SVG") return true;
    return asKids(n).some(walk);
  };
  return walk(host);
}

afterEach(() => {
  globalThis.Worker = RealWorker;
  resetLayoutClient();
  FakeWorker.all = [];
});

test("GraphView shows the spinner until the worker replies, then the svg", async () => {
  FakeWorker.all = [];
  globalThis.Worker = FakeWorker as unknown as typeof Worker;
  const host = mountDom();
  const root: Root = createRoot(host);
  await act(async () => {
    root.render(createElement(GraphView, { graph, query: "", selectedId: null, onSelect: () => undefined }));
  });
  expect(findStatus(host)).toContain("Laying out graph");
  expect(findSvg(host)).toBe(false);
  expect(liveLayoutWorkers()).toBe(1);
  const worker = FakeWorker.all[0];
  await act(async () => {
    worker?.emit({ id: worker.messages[0]?.id, pos: [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }] });
  });
  expect(findStatus(host)).toBeNull();
  expect(findSvg(host)).toBe(true);
  await act(async () => {
    root.unmount();
  });
  expect(liveLayoutWorkers()).toBe(0);
});

test("unmounting GraphView while layout is in flight terminates the worker", async () => {
  FakeWorker.all = [];
  globalThis.Worker = FakeWorker as unknown as typeof Worker;
  const host = mountDom();
  const root: Root = createRoot(host);
  await act(async () => {
    root.render(createElement(GraphView, { graph, query: "", selectedId: null, onSelect: () => undefined }));
  });
  const worker = FakeWorker.all[0];
  expect(worker?.terminated).toBe(false);
  await act(async () => {
    root.unmount();
  });
  expect(worker?.terminated).toBe(true);
  expect(liveLayoutWorkers()).toBe(0);
});

test("a cached layout renders the graph without starting a worker", async () => {
  FakeWorker.all = [];
  globalThis.Worker = FakeWorker as unknown as typeof Worker;
  rememberLayout(layoutKey(graph.nodes, graph.edges), [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }]);
  const host = mountDom();
  const root: Root = createRoot(host);
  await act(async () => {
    root.render(createElement(GraphView, { graph, query: "", selectedId: null, onSelect: () => undefined }));
  });
  expect(findStatus(host)).toBeNull();
  expect(findSvg(host)).toBe(true);
  expect(FakeWorker.all.length).toBe(0);
  await act(async () => {
    root.unmount();
  });
});

test("new graph data drops the previous positions until the next layout", async () => {
  FakeWorker.all = [];
  globalThis.Worker = FakeWorker as unknown as typeof Worker;
  rememberLayout(layoutKey(graph.nodes, graph.edges), [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }]);
  const host = mountDom();
  const root: Root = createRoot(host);
  await act(async () => {
    root.render(createElement(GraphView, { graph, query: "", selectedId: null, onSelect: () => undefined }));
  });
  expect(findSvg(host)).toBe(true);
  const next = {
    ...graph,
    nodes: [graph.nodes[0]!, { ...graph.nodes[1]!, attempts: 9 }],
  };
  await act(async () => {
    root.render(createElement(GraphView, { graph: next, query: "", selectedId: null, onSelect: () => undefined }));
  });
  expect(findStatus(host)).toContain("Laying out graph");
  expect(findSvg(host)).toBe(false);
  expect(FakeWorker.all.length).toBe(1);
  await act(async () => {
    root.unmount();
  });
});
