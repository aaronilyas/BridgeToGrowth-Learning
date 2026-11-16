import { afterEach, expect, test } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { CodeSpec } from "../../shared/code.ts";
import { CodeExercise } from "../components/CodeExercise.tsx";
import { runPython } from "./runner.ts";
import { indexURLOf, livePythonWorkers, prewarmPython, resetWarmPool, warmStatus } from "./warm.ts";

const indexURL = new URL("../../../node_modules/pyodide/", import.meta.url).pathname;
const spec: CodeSpec = { language: "python", starter: "", libraries: [] };
const numpy: CodeSpec = { language: "python", starter: "", libraries: ["numpy"] };

type Posted = { type?: string; libs?: string[]; code?: string; tests?: unknown[] };

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

function useFakeWorkers(): void {
  FakeWorker.all = [];
  globalThis.Worker = FakeWorker as unknown as typeof Worker;
}

function result(stdout: string): { type: "result"; stdout: string; stderr: string; error: null; tests: []; bytes: number } {
  return { type: "result", stdout, stderr: "", error: null, tests: [], bytes: 1 };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

afterEach(() => {
  globalThis.Worker = RealWorker;
  resetWarmPool();
  FakeWorker.all = [];
});

test("unmounting a code question leaves no worker", () => {
  useFakeWorkers();
  const release = prewarmPython(spec, { indexURL });
  const worker = FakeWorker.all[0];
  expect(worker?.messages[0]).toMatchObject({ type: "boot", libs: [] });
  expect(livePythonWorkers()).toBe(1);
  release();
  expect(worker?.terminated).toBe(true);
  expect(livePythonWorkers()).toBe(0);
  expect(warmStatus(indexURL, [])).toBe("absent");
});

test("a library change terminates the previous worker", () => {
  useFakeWorkers();
  const releaseEmpty = prewarmPython(spec, { indexURL });
  const first = FakeWorker.all[0];
  releaseEmpty();
  expect(first?.terminated).toBe(true);
  const releaseNumpy = prewarmPython(numpy, { indexURL });
  const second = FakeWorker.all[1];
  expect(second?.messages[0]).toMatchObject({ type: "boot", libs: ["numpy"] });
  expect(livePythonWorkers()).toBe(1);
  releaseNumpy();
  expect(second?.terminated).toBe(true);
  expect(livePythonWorkers()).toBe(0);
});

test("two mounts of the same libraries share one worker", () => {
  useFakeWorkers();
  const first = prewarmPython(spec, { indexURL });
  const second = prewarmPython(spec, { indexURL });
  expect(FakeWorker.all.length).toBe(1);
  expect(livePythonWorkers()).toBe(1);
  first();
  expect(FakeWorker.all[0]?.terminated).toBe(false);
  expect(livePythonWorkers()).toBe(1);
  second();
  expect(FakeWorker.all[0]?.terminated).toBe(true);
  expect(livePythonWorkers()).toBe(0);
});

test("a run uses the warm worker once, then a fresh one is booted", async () => {
  useFakeWorkers();
  const release = prewarmPython(spec, { indexURL });
  const first = FakeWorker.all[0];
  expect(first).toBeDefined();
  first?.emit({ type: "booted" });
  expect(warmStatus(indexURL, [])).toBe("ready");
  const pending = runPython(spec, "print(1)\n", { indexURL, tests: [{ name: "t", code: "assert True\n" }], guardDefs: false });
  expect(FakeWorker.all.length).toBe(1);
  const run = first?.messages.find((m) => m.type === "run");
  expect(run).toMatchObject({ code: "print(1)\n", libs: [], guardDefs: false });
  expect(run?.tests).toEqual([{ name: "t", code: "assert True\n" }]);
  first?.emit({ type: "ready" });
  first?.emit(result("1\n"));
  const ran = await pending;
  expect(ran.stdout).toBe("1\n");
  expect(ran.error).toBeNull();
  expect(ran.timedOut).toBe(false);
  expect(ran.started).toBe(true);
  expect(first?.terminated).toBe(true);
  expect(first?.messages.filter((m) => m.type === "run")).toHaveLength(1);
  const second = FakeWorker.all[1];
  expect(second?.terminated).toBe(false);
  expect(second?.messages[0]).toMatchObject({ type: "boot", libs: [] });
  expect(livePythonWorkers()).toBe(1);
  release();
  expect(second?.terminated).toBe(true);
  expect(livePythonWorkers()).toBe(0);
});

test("the time limit starts when user code starts and the shown duration includes a late boot", async () => {
  useFakeWorkers();
  const release = prewarmPython(spec, { indexURL });
  const worker = FakeWorker.all[0];
  let settled = false;
  const pending = runPython(spec, "print(1)\n", { indexURL, timeoutMs: 200, tests: [] }).then((ran) => {
    settled = true;
    return ran;
  });
  expect(livePythonWorkers()).toBe(1);
  await sleep(400);
  expect(settled).toBe(false);
  worker?.emit({ type: "ready" });
  worker?.emit(result("1\n"));
  const ran = await pending;
  expect(ran.timedOut).toBe(false);
  expect(ran.error).toBeNull();
  expect(ran.durationMs).toBeGreaterThanOrEqual(400);
  release();
});

test("after ready, terminate() still enforces the time limit", async () => {
  useFakeWorkers();
  const release = prewarmPython(spec, { indexURL });
  const worker = FakeWorker.all[0];
  const pending = runPython(spec, "while True:\n    pass\n", { indexURL, timeoutMs: 200, tests: [] });
  worker?.emit({ type: "ready" });
  const ran = await pending;
  expect(ran.started).toBe(true);
  expect(ran.timedOut).toBe(true);
  expect(ran.error ?? "").toContain("Time limit exceeded");
  expect(worker?.terminated).toBe(true);
  release();
  expect(livePythonWorkers()).toBe(0);
});

test("a failed warm boot falls back to a cold run with the same error", async () => {
  useFakeWorkers();
  const release = prewarmPython(numpy, { indexURL });
  const warm = FakeWorker.all[0];
  warm?.emit({ type: "error", message: "wasm missing" });
  expect(warm?.terminated).toBe(true);
  expect(warmStatus(indexURL, ["numpy"])).toBe("failed");
  expect(livePythonWorkers()).toBe(0);
  const pending = runPython(numpy, "print(1)\n", { indexURL, tests: [] });
  const cold = FakeWorker.all[1];
  expect(cold).toBeDefined();
  expect(cold).not.toBe(warm);
  expect(cold?.messages.map((m) => m.type)).toEqual(["run"]);
  expect(cold?.messages[0]?.libs).toEqual(["numpy"]);
  cold?.emit({ type: "error", message: "wasm missing" });
  const ran = await pending;
  expect(ran.started).toBe(false);
  expect(ran.timedOut).toBe(false);
  expect(ran.error).toBe("Python failed to start. wasm missing");
  expect(ran.stdout).toBe("");
  const again = FakeWorker.all[2];
  expect(again?.messages[0]).toMatchObject({ type: "boot", libs: ["numpy"] });
  release();
  expect(again?.terminated).toBe(true);
  expect(livePythonWorkers()).toBe(0);
  expect(warmStatus(indexURL, ["numpy"])).toBe("absent");
});

type MiniNode = {
  nodeType: number;
  nodeName: string;
  ownerDocument: MiniDoc;
  parentNode: MiniNode | null;
  childNodes: MiniNode[];
  style: { setProperty: (name: string, value: string) => void; getPropertyValue: (name: string) => string } & Record<string, string>;
  namespaceURI: string | null;
  textContent: string;
  className: string;
  value: string;
  disabled: boolean;
  tagName: string;
  firstChild: MiniNode | null;
  lastChild: MiniNode | null;
  nextSibling: MiniNode | null;
  previousSibling: MiniNode | null;
  appendChild: (child: MiniNode) => MiniNode;
  insertBefore: (child: MiniNode, ref: MiniNode | null) => MiniNode;
  removeChild: (child: MiniNode) => MiniNode;
  setAttribute: (name: string, value: string) => void;
  getAttribute: (name: string) => string | null;
  removeAttribute: (name: string) => void;
  hasAttribute: (name: string) => boolean;
  addEventListener: () => void;
  removeEventListener: () => void;
  focus: () => void;
  setSelectionRange: () => void;
  contains: (node: MiniNode) => boolean;
};

type MiniDoc = MiniNode & {
  documentElement: MiniNode;
  body: MiniNode;
  defaultView: typeof globalThis;
  activeElement: MiniNode | null;
  createElement: (tag: string) => MiniNode;
  createElementNS: (ns: string, tag: string) => MiniNode;
  createTextNode: (text: string) => MiniNode;
  createComment: (text: string) => MiniNode;
};

function installDocument(): { doc: MiniDoc; restore: () => void } {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "document");
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: globalThis });
  Object.assign(globalThis, { HTMLIFrameElement: class HTMLIFrameElement {}, IS_REACT_ACT_ENVIRONMENT: true });
  const makeStyle = (): MiniNode["style"] => {
    const style = {} as MiniNode["style"];
    style.setProperty = (name, value) => {
      style[name] = value;
    };
    style.getPropertyValue = (name) => style[name] ?? "";
    return style;
  };
  const link = (node: MiniNode): void => {
    const i = node.parentNode ? node.parentNode.childNodes.indexOf(node) : -1;
    node.firstChild = node.childNodes[0] ?? null;
    node.lastChild = node.childNodes[node.childNodes.length - 1] ?? null;
    node.nextSibling = i >= 0 ? (node.parentNode?.childNodes[i + 1] ?? null) : null;
    node.previousSibling = i > 0 ? (node.parentNode?.childNodes[i - 1] ?? null) : null;
  };
  const doc = {} as MiniDoc;
  const node = (type: number, name: string): MiniNode => {
    const el: MiniNode = {
      nodeType: type,
      nodeName: name,
      ownerDocument: doc,
      parentNode: null,
      childNodes: [],
      style: makeStyle(),
      namespaceURI: "http://www.w3.org/1999/xhtml",
      textContent: "",
      className: "",
      value: "",
      disabled: false,
      tagName: name,
      firstChild: null,
      lastChild: null,
      nextSibling: null,
      previousSibling: null,
      appendChild(child: MiniNode) {
        return el.insertBefore(child, null);
      },
      insertBefore(child: MiniNode, ref: MiniNode | null) {
        if (child.parentNode) child.parentNode.removeChild(child);
        child.parentNode = el;
        const at = ref ? el.childNodes.indexOf(ref) : el.childNodes.length;
        el.childNodes.splice(at < 0 ? el.childNodes.length : at, 0, child);
        link(el);
        for (const kid of el.childNodes) link(kid);
        return child;
      },
      removeChild(child: MiniNode) {
        const at = el.childNodes.indexOf(child);
        if (at >= 0) el.childNodes.splice(at, 1);
        child.parentNode = null;
        link(el);
        for (const kid of el.childNodes) link(kid);
        return child;
      },
      setAttribute(name: string, value: string) {
        if (name === "class") el.className = value;
      },
      getAttribute: () => null,
      removeAttribute() {},
      hasAttribute: () => false,
      addEventListener() {},
      removeEventListener() {},
      focus() {},
      setSelectionRange() {},
      contains(other: MiniNode): boolean {
        let current: MiniNode | null = other;
        while (current) {
          if (current === el) return true;
          current = current.parentNode;
        }
        return false;
      },
    };
    return el;
  };
  Object.assign(doc, node(9, "#document"));
  doc.createElement = (tag) => node(1, tag.toUpperCase());
  doc.createElementNS = (_ns, tag) => doc.createElement(tag);
  doc.createTextNode = (text) => {
    const el = node(3, "#text");
    el.textContent = text;
    return el;
  };
  doc.createComment = (text) => {
    const el = node(8, "#comment");
    el.textContent = text;
    return el;
  };
  doc.defaultView = globalThis;
  doc.activeElement = null;
  doc.documentElement = doc.createElement("html");
  doc.body = doc.createElement("body");
  doc.appendChild(doc.documentElement);
  doc.documentElement.appendChild(doc.body);
  Object.defineProperty(globalThis, "document", { configurable: true, value: doc });
  return {
    doc,
    restore() {
      if (previous) Object.defineProperty(globalThis, "document", previous);
      else delete (globalThis as { document?: unknown }).document;
      if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
      else delete (globalThis as { window?: unknown }).window;
      delete (globalThis as { HTMLIFrameElement?: unknown }).HTMLIFrameElement;
      delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: unknown }).IS_REACT_ACT_ENVIRONMENT;
    },
  };
}

test("CodeExercise unmount terminates its warm worker", async () => {
  useFakeWorkers();
  const previousLocation = Object.getOwnPropertyDescriptor(globalThis, "location");
  Object.defineProperty(globalThis, "location", { configurable: true, value: { origin: "http://127.0.0.1:3000" } });
  const { doc, restore } = installDocument();
  let root: Root | null = null;
  try {
    root = createRoot(doc.body as unknown as HTMLElement);
    await act(async () => {
      root?.render(<CodeExercise spec={spec} value={"print(1)\n"} onChange={() => undefined} disabled={false} />);
    });
    expect(livePythonWorkers()).toBe(1);
    const worker = FakeWorker.all[0];
    expect(worker?.terminated).toBe(false);
    expect(worker?.messages[0]).toMatchObject({ type: "boot", libs: [], indexURL: "http://127.0.0.1:3000/pyodide/" });
    expect(warmStatus(indexURLOf(), [])).toBe("booting");
    await act(async () => {
      root?.unmount();
    });
    expect(worker?.terminated).toBe(true);
    expect(livePythonWorkers()).toBe(0);
    expect(warmStatus(indexURLOf(), [])).toBe("absent");
  } finally {
    root?.unmount();
    restore();
    if (previousLocation) Object.defineProperty(globalThis, "location", previousLocation);
    else delete (globalThis as { location?: unknown }).location;
  }
});

test("a page with no usable origin pre-warms nothing and does not throw", () => {
  useFakeWorkers();
  const saved = Object.getOwnPropertyDescriptor(globalThis, "location");
  Object.defineProperty(globalThis, "location", { value: { origin: "null" }, configurable: true });
  try {
    const release = prewarmPython(spec);
    expect(FakeWorker.all.length).toBe(0);
    release();
  } finally {
    if (saved) Object.defineProperty(globalThis, "location", saved);
    else delete (globalThis as { location?: unknown }).location;
  }
});
