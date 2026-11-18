import { afterEach, expect, test } from "bun:test";
import {
  cachedLayout,
  LAYOUT_CACHE_CAP,
  liveLayoutWorkers,
  rememberLayout,
  requestLayout,
  resetLayoutClient,
} from "./layoutClient.ts";
import { layoutGraph, layoutKey, type LayoutEdge, type LayoutNode, type Point } from "./layout.ts";

const sample: { nodes: LayoutNode[]; edges: LayoutEdge[] } = {
  nodes: [
    { id: "a", domain: "math", attempts: 4 },
    { id: "b", domain: "physics", attempts: 1 },
  ],
  edges: [{ src: "a", dst: "b" }],
};

type Posted = { id?: number; nodes?: LayoutNode[]; edges?: LayoutEdge[] };

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
  fail(): void {
    this.onerror?.({ message: "worker failed" } as ErrorEvent);
  }
}

const RealWorker = globalThis.Worker;

function useFakeWorkers(): void {
  FakeWorker.all = [];
  globalThis.Worker = FakeWorker as unknown as typeof Worker;
}

afterEach(() => {
  Object.defineProperty(globalThis, "Worker", { configurable: true, value: RealWorker });
  resetLayoutClient();
  FakeWorker.all = [];
});

test("the session cache is bounded and returns the stored positions", () => {
  for (let i = 0; i <= LAYOUT_CACHE_CAP; i++) rememberLayout(`k${i}`, [{ x: i, y: 0 }]);
  expect(cachedLayout("k0")).toBeUndefined();
  expect(cachedLayout("k1")).toEqual([{ x: 1, y: 0 }]);
  expect(cachedLayout(`k${LAYOUT_CACHE_CAP}`)).toEqual([{ x: LAYOUT_CACHE_CAP, y: 0 }]);
  rememberLayout("k1", [{ x: 99, y: 1 }]);
  rememberLayout("fresh", [{ x: 0, y: 2 }]);
  expect(cachedLayout("k2")).toBeUndefined();
  expect(cachedLayout("k1")).toEqual([{ x: 99, y: 1 }]);
});

test("a cache hit does not start a worker", () => {
  useFakeWorkers();
  const key = layoutKey(sample.nodes, sample.edges);
  const pos = [{ x: 3, y: 4 }];
  rememberLayout(key, pos);
  const got: Point[][] = [];
  const cancel = requestLayout(sample.nodes, sample.edges, (p) => {
    got.push(p);
  });
  expect(got).toEqual([pos]);
  expect(FakeWorker.all.length).toBe(0);
  expect(liveLayoutWorkers()).toBe(0);
  cancel();
});

test("a cancelled in-flight layout ignores the stale reply", () => {
  useFakeWorkers();
  const first: Point[][] = [];
  const second: Point[][] = [];
  const cancelFirst = requestLayout(sample.nodes, sample.edges, (p) => first.push(p));
  const other = { nodes: [{ id: "c", domain: "cs", attempts: 2 }], edges: [] as LayoutEdge[] };
  const cancelSecond = requestLayout(other.nodes, other.edges, (p) => second.push(p));
  const w = FakeWorker.all[0];
  expect(w?.messages.length).toBe(2);
  const staleId = w?.messages[0]?.id;
  const liveId = w?.messages[1]?.id;
  cancelFirst();
  w?.emit({ id: staleId, pos: [{ x: 1, y: 1 }] });
  w?.emit({ id: liveId, pos: [{ x: 2, y: 2 }] });
  expect(first).toEqual([]);
  expect(second).toEqual([[{ x: 2, y: 2 }]]);
  cancelSecond();
  expect(liveLayoutWorkers()).toBe(0);
});

test("a worker error falls back to layoutGraph on the main thread", () => {
  useFakeWorkers();
  const got: Point[][] = [];
  requestLayout(sample.nodes, sample.edges, (p) => {
    got.push(p);
  });
  FakeWorker.all[0]?.fail();
  expect(got).toEqual([layoutGraph(sample.nodes, sample.edges)]);
  expect(liveLayoutWorkers()).toBe(0);
});

test("a worker error reply falls back to layoutGraph", () => {
  useFakeWorkers();
  const got: Point[][] = [];
  requestLayout(sample.nodes, sample.edges, (p) => {
    got.push(p);
  });
  FakeWorker.all[0]?.emit({ id: FakeWorker.all[0]?.messages[0]?.id, error: "boom" });
  expect(got).toEqual([layoutGraph(sample.nodes, sample.edges)]);
  expect(liveLayoutWorkers()).toBe(0);
});

test("without Worker, layout runs synchronously on the main thread", () => {
  Object.defineProperty(globalThis, "Worker", { configurable: true, value: undefined });
  const got: Point[][] = [];
  const cancel = requestLayout(sample.nodes, sample.edges, (p) => {
    got.push(p);
  });
  expect(got).toEqual([layoutGraph(sample.nodes, sample.edges)]);
  expect(liveLayoutWorkers()).toBe(0);
  cancel();
});

test("cancelling the last in-flight job terminates the worker", () => {
  useFakeWorkers();
  const cancel = requestLayout(sample.nodes, sample.edges, () => undefined);
  expect(liveLayoutWorkers()).toBe(1);
  expect(FakeWorker.all[0]?.terminated).toBe(false);
  cancel();
  expect(FakeWorker.all[0]?.terminated).toBe(true);
  expect(liveLayoutWorkers()).toBe(0);
});

test("the worker returns the same positions as layoutGraph", async () => {
  const expected = layoutGraph(sample.nodes, sample.edges);
  const got = await new Promise<Point[]>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("layout worker timed out")), 10_000);
    requestLayout(sample.nodes, sample.edges, (pos) => {
      clearTimeout(t);
      resolve(pos);
    });
  });
  expect(got).toEqual(expected);
  expect(liveLayoutWorkers()).toBe(0);
});
