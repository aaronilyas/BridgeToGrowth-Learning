import { CODE_MEMORY_BYTES, RUN_TIMEOUT_MS, type CodeSpec, type CodeTest, type CodeTestResult } from "../../shared/code.ts";
import { HarnessRun } from "../../shared/codeGrade.ts";
import { parseOut } from "./protocol.ts";

const LOAD_TIMEOUT_MS = 60_000;

export type RunResult = {
  stdout: string;
  stderr: string;
  error: string | null;
  timedOut: boolean;
  durationMs: number;
  tests: CodeTestResult[];
  started: boolean;
};

export type RunOptions = {
  tests?: readonly CodeTest[];
  guardDefs?: boolean;
  timeoutMs?: number;
  memoryBytes?: number;
  indexURL?: string;
};

export type FetchProbe = { fetch: string; jsFetch: string; pyfetch: string };

// O(1)
function withSlash(url: string): string {
  return url.endsWith("/") ? url : `${url}/`;
}

// O(1)
function defaultIndex(): string {
  const origin = globalThis.location?.origin;
  if (!origin || origin === "null") throw new Error("Python failed to start.");
  return new URL("/pyodide/", origin).href;
}

// O(t)
function notRun(tests: readonly CodeTest[]): CodeTestResult[] {
  return tests.map((t) => ({ name: t.name, passed: false, error: "not run" }));
}

// O(code + output). One worker per call; terminate() is the timeout and the memory cap.
// SEC: libraries and hidden tests are the question's. The worker loads only those wheels, then blocks network APIs.
export function runPython(spec: CodeSpec, userCode: string, opts: RunOptions = {}): Promise<RunResult> {
  const timeoutMs = opts.timeoutMs ?? RUN_TIMEOUT_MS;
  const memoryBytes = opts.memoryBytes ?? CODE_MEMORY_BYTES;
  const tests = [...(opts.tests ?? [])];
  const indexURL = withSlash(opts.indexURL ?? defaultIndex());
  const guardDefs = opts.guardDefs ?? true;
  const startedAt = performance.now();
  const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  const seconds = Math.max(1, Math.round(timeoutMs / 1000));
  const memoryError = `Your code was stopped: it used more than ${Math.round(memoryBytes / (1024 * 1024))} MB of memory.`;

  return new Promise((resolve) => {
    let settled = false;
    let phase: "load" | "run" = "load";
    let runTimer: ReturnType<typeof setTimeout> | null = null;
    const finish = (r: RunResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(loadTimer);
      if (runTimer !== null) clearTimeout(runTimer);
      worker.terminate();
      resolve(r);
    };
    const stopped = (error: string, timedOut: boolean, started: boolean): RunResult => ({
      stdout: "",
      stderr: "",
      error,
      timedOut,
      durationMs: Math.round(performance.now() - startedAt),
      tests: notRun(tests),
      started,
    });
    const loadTimer = setTimeout(() => finish(stopped("Python failed to start.", false, false)), LOAD_TIMEOUT_MS);
    worker.onmessage = (ev: MessageEvent<unknown>): void => {
      const msg = parseOut(ev.data);
      if (!msg || settled) return;
      if (msg.type === "ready") {
        phase = "run";
        clearTimeout(loadTimer);
        runTimer = setTimeout(() => finish(stopped(`Time limit exceeded (${seconds} s).`, true, true)), timeoutMs);
        return;
      }
      if (msg.type === "memory") {
        if (msg.bytes > memoryBytes) finish(stopped(memoryError, false, true));
        return;
      }
      if (msg.type === "error") {
        finish(stopped(phase === "run" ? msg.message : `Python failed to start. ${msg.message}`.slice(0, 300), false, phase === "run"));
        return;
      }
      if (msg.type !== "result") return;
      if (msg.bytes > memoryBytes) {
        finish(stopped(memoryError, false, true));
        return;
      }
      const parsed = HarnessRun.safeParse({ stdout: msg.stdout, stderr: msg.stderr, error: msg.error, tests: msg.tests });
      if (!parsed.success) {
        finish(stopped("Your code was stopped: it crashed the interpreter.", false, true));
        return;
      }
      finish({ ...parsed.data, timedOut: false, durationMs: Math.round(performance.now() - startedAt), started: true });
    };
    worker.onerror = (ev: ErrorEvent): void => {
      const detail = ev.message || "error";
      finish(stopped(phase === "run" ? "Your code was stopped: it used more than 512 MB of memory or crashed the interpreter." : `Python failed to start. ${detail}`.slice(0, 300), false, phase === "run"));
    };
    worker.postMessage({ type: "run", code: userCode, libs: [...spec.libraries], tests, guardDefs, indexURL, memoryBytes });
  });
}

// O(1) plus one Pyodide boot
// SEC: the same worker prelude as a real run. User Python calls js.fetch and pyodide.http.pyfetch after network APIs are replaced.
export function probeUserFetch(indexURL: string): Promise<FetchProbe> {
  const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      worker.terminate();
      reject(new Error("Python failed to start."));
    }, LOAD_TIMEOUT_MS);
    worker.onmessage = (ev: MessageEvent<unknown>): void => {
      const msg = parseOut(ev.data);
      if (!msg || msg.type !== "fetchprobe") return;
      clearTimeout(timer);
      worker.terminate();
      resolve({ fetch: msg.fetch, jsFetch: msg.jsFetch, pyfetch: msg.pyfetch });
    };
    worker.onerror = (): void => {
      clearTimeout(timer);
      worker.terminate();
      reject(new Error("Python failed to start."));
    };
    worker.postMessage({ type: "fetchprobe", indexURL: withSlash(indexURL) });
  });
}
