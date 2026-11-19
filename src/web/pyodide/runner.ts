import { CODE_MEMORY_BYTES, RUN_TIMEOUT_MS, type CodeSpec, type CodeTest, type CodeTestResult } from "../../shared/code.ts";
import { HarnessRun } from "../../shared/codeGrade.ts";
import { PLOT_MODULES } from "../../shared/visual.ts";
import { parseOut } from "./protocol.ts";
import { claimWarm, createPythonWorker, indexURLOf, replenishWarm, stopPythonWorker } from "./warm.ts";

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

export type FigureResult = { svg: string | null; error: string | null; timedOut: boolean; durationMs: number };

type Job = { code: string; libs: string[]; tests: CodeTest[]; guardDefs: boolean; figure: boolean; modules: string[] };

export type FetchProbe = { fetch: string; jsFetch: string; pyfetch: string };

// O(t)
function notRun(tests: readonly CodeTest[]): CodeTestResult[] {
  return tests.map((t) => ({ name: t.name, passed: false, error: "not run" }));
}

// O(code + output). One worker per call; terminate() is the timeout and the memory cap.
// INV: the time limit starts when the worker reports ready, which is when user code starts. durationMs starts at this call, so a warm worker that is still booting counts in the shown duration.
// SEC: the worker loads only the job's wheels, then blocks network APIs
function runJob(job: Job, opts: RunOptions): Promise<RunResult & { svg: string | null }> {
  const timeoutMs = opts.timeoutMs ?? RUN_TIMEOUT_MS;
  const memoryBytes = opts.memoryBytes ?? CODE_MEMORY_BYTES;
  const tests = job.tests;
  const indexURL = indexURLOf(opts.indexURL);
  const libs = job.libs;
  const startedAt = performance.now();
  const worker = claimWarm(indexURL, libs) ?? createPythonWorker();
  const seconds = Math.max(1, Math.round(timeoutMs / 1000));
  const memoryError = `Your code was stopped: it used more than ${Math.round(memoryBytes / (1024 * 1024))} MB of memory.`;

  return new Promise((resolve) => {
    let settled = false;
    let phase: "load" | "run" = "load";
    let runTimer: ReturnType<typeof setTimeout> | null = null;
    const finish = (r: RunResult & { svg: string | null }): void => {
      if (settled) return;
      settled = true;
      clearTimeout(loadTimer);
      if (runTimer !== null) clearTimeout(runTimer);
      stopPythonWorker(worker);
      replenishWarm(indexURL, libs);
      resolve(r);
    };
    const stopped = (error: string, timedOut: boolean, started: boolean): RunResult & { svg: null } => ({
      svg: null,
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
      finish({ ...parsed.data, svg: msg.svg, timedOut: false, durationMs: Math.round(performance.now() - startedAt), started: true });
    };
    worker.onerror = (ev: ErrorEvent): void => {
      // INV: a worker script that fails to load (404, or HTML served in its place) raises an ErrorEvent with no message
      const detail = ev.message || "The Python worker script could not be loaded.";
      finish(stopped(phase === "run" ? "Your code was stopped: it used more than 512 MB of memory or crashed the interpreter." : `Python failed to start. ${detail}`.slice(0, 300), false, phase === "run"));
    };
    worker.postMessage({ type: "run", ...job, indexURL, memoryBytes });
  });
}

// O(code + output)
// SEC: libraries and hidden tests are the question's
export async function runPython(spec: CodeSpec, userCode: string, opts: RunOptions = {}): Promise<RunResult> {
  const { svg: _svg, ...r } = await runJob({ code: userCode, libs: [...spec.libraries], tests: [...(opts.tests ?? [])], guardDefs: opts.guardDefs ?? true, figure: false, modules: [] }, opts);
  return r;
}

// O(code + figure size)
// SEC: plot code may import only PLOT_MODULES; the harness bans show, savefig and open and returns the current figure as SVG text
export async function runFigure(code: string, opts: RunOptions = {}): Promise<FigureResult> {
  const r = await runJob({ code, libs: ["numpy", "matplotlib"], tests: [], guardDefs: true, figure: true, modules: [...PLOT_MODULES] }, opts);
  return { svg: r.error === null ? r.svg : null, error: r.error, timedOut: r.timedOut, durationMs: r.durationMs };
}

// O(1) plus one Pyodide boot
// SEC: the same worker prelude as a real run. User Python calls js.fetch and pyodide.http.pyfetch after network APIs are replaced.
export function probeUserFetch(indexURL: string): Promise<FetchProbe> {
  const worker = createPythonWorker();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      stopPythonWorker(worker);
      reject(new Error("Python failed to start."));
    }, LOAD_TIMEOUT_MS);
    worker.onmessage = (ev: MessageEvent<unknown>): void => {
      const msg = parseOut(ev.data);
      if (!msg || msg.type !== "fetchprobe") return;
      clearTimeout(timer);
      stopPythonWorker(worker);
      resolve({ fetch: msg.fetch, jsFetch: msg.jsFetch, pyfetch: msg.pyfetch });
    };
    worker.onerror = (): void => {
      clearTimeout(timer);
      stopPythonWorker(worker);
      reject(new Error("Python failed to start."));
    };
    worker.postMessage({ type: "fetchprobe", indexURL: indexURLOf(indexURL) });
  });
}
