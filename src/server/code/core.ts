import { z } from "zod";
import { CODE_LIBRARIES, CODE_MAX_CHARS, CODE_MAX_LIBRARIES, CODE_MAX_TESTS, CodeLibrary, CodeTest, CodeTestResult, type CodeRunResponse, type CodeSpec } from "../../shared/code.ts";

export const SANDBOX_PYTHON = "/usr/bin/python3";
export const RUN_TIMEOUT_MS = 10_000;
export const STDOUT_CAP = 256 * 1024;
export const MAX_CONCURRENT_RUNS = 2;
const TMPFS_BYTES = 8 * 1024 * 1024;
const LIMITS = ["--as=1073741824", "--cpu=5", "--fsize=1048576", "--nofile=64", "--core=0"];
const SANDBOX_ENV = ["--setenv", "PATH", "/usr/bin", "--setenv", "LANG", "C.UTF-8", "--setenv", "HOME", "/tmp", "--setenv", "OPENBLAS_NUM_THREADS", "1", "--setenv", "OMP_NUM_THREADS", "1", "--setenv", "MPLBACKEND", "Agg"];

export const HarnessRun = z.strictObject({ stdout: z.string(), stderr: z.string(), error: z.string().nullable(), tests: z.array(CodeTestResult).max(CODE_MAX_TESTS) });
export type HarnessRun = z.infer<typeof HarnessRun>;
export const HarnessProbe = z.strictObject({ available: z.array(z.string()) });

// INV: questions.answer jsonb for a code question; tests and the reference solution never leave the server before an attempt
export const StoredCodeAnswer = z.strictObject({ tests: z.array(CodeTest).min(1).max(CODE_MAX_TESTS), model: z.string() });
export type StoredCodeAnswer = z.infer<typeof StoredCodeAnswer>;

export type SandboxOutcome = { stdout: string; timedOut: boolean; durationMs: number };
export type CodeRun = { run: HarnessRun; timedOut: boolean; durationMs: number };

// O(1)
// SEC: bubblewrap gives fresh user, pid, net, ipc, uts and cgroup namespaces with no network, nested user namespaces disabled and all capabilities dropped;
// SEC: the only filesystem is read-only /usr (the interpreter and the system site-packages), a small private /tmp and a minimal /dev; no /home, /etc, /proc or /run;
// SEC: prlimit caps memory, CPU seconds, written file size and open files; the environment is cleared; the child dies with its parent and gets its own session
export function buildSandboxArgv(prlimit: string, bwrap: string, harness: string): string[] {
  return [
    prlimit, ...LIMITS, "--",
    bwrap,
    "--unshare-all", "--unshare-user", "--disable-userns", "--die-with-parent", "--new-session", "--cap-drop", "ALL", "--uid", "65534", "--gid", "65534", "--hostname", "sandbox",
    "--ro-bind", "/usr", "/usr", "--symlink", "usr/lib", "/lib", "--symlink", "usr/lib", "/lib64", "--symlink", "usr/bin", "/bin",
    "--dev", "/dev", "--size", String(TMPFS_BYTES), "--tmpfs", "/tmp", "--chdir", "/tmp",
    "--clearenv", ...SANDBOX_ENV,
    "--", SANDBOX_PYTHON, "-I", "-B", "-c", harness,
  ];
}

// O(n) in payload size
// INV: libraries are passed as the import allowlist; each hidden test runs in a shallow copy of the learner namespace
// SEC: guardDefs is chosen by the server. Learner submissions keep it on. A reference-solution check passes false so model-written code is not rejected for dunder names
export function buildRunPayload(nonce: string, libs: readonly CodeLibrary[], code: string, tests: readonly CodeTest[], guardDefs: boolean = true): string {
  return JSON.stringify({ mode: "run", nonce, libs, code, tests, guardDefs });
}

// O(1)
export function buildProbePayload(nonce: string): string {
  return JSON.stringify({ mode: "probe", nonce, candidates: CODE_LIBRARIES });
}

// O(n) in output size
// SEC: the sandbox's stdout is untrusted; only the last nonce-prefixed line is parsed, and it must match the schema
export function parseHarnessLine<T>(stdout: string, nonce: string, schema: z.ZodType<T>): T | null {
  const at = stdout.lastIndexOf(`\n${nonce}`);
  if (at < 0) return null;
  const line = stdout.slice(at + 1 + nonce.length).split("\n", 1)[0] ?? "";
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return null;
  }
  const r = schema.safeParse(raw);
  return r.success ? r.data : null;
}

// O(c) in catalog size
// INV: keeps only catalog entries, in catalog order
export function toAvailableLibraries(found: readonly string[]): CodeLibrary[] {
  return CODE_LIBRARIES.filter((l) => found.includes(l));
}

// O(t) in tests
// INV: a missing harness result means the sandbox was killed (time, memory or crash): every test fails with that reason
export function settleRun(o: SandboxOutcome, parsed: HarnessRun | null, tests: readonly CodeTest[]): CodeRun {
  if (parsed) return { run: parsed, timedOut: false, durationMs: o.durationMs };
  const error = o.timedOut ? `Time limit exceeded (${RUN_TIMEOUT_MS / 1000} s).` : "Your code was stopped: it used more than 5 s of CPU time or 1 GB of memory, or crashed the interpreter.";
  return { run: { stdout: "", stderr: "", error, tests: tests.map((t) => ({ name: t.name, passed: false, error: "not run" })) }, timedOut: o.timedOut, durationMs: o.durationMs };
}

// O(1)
export function toRunResponse(r: CodeRun): CodeRunResponse {
  return { stdout: r.run.stdout, stderr: r.run.stderr, error: r.run.error, timedOut: r.timedOut, durationMs: r.durationMs };
}

// O(t)
// INV: score is the share of hidden tests passed; 0 when there are none
export function scoreTests(results: readonly CodeTestResult[]): number {
  return results.length === 0 ? 0 : results.filter((r) => r.passed).length / results.length;
}

// O(t)
export function codeFeedback(r: HarnessRun): string {
  const passed = r.tests.filter((t) => t.passed).length;
  const head = `${passed} of ${r.tests.length} tests passed.`;
  return (r.error ? `${head} Your code raised an error: ${r.error}` : head).slice(0, 600);
}

export type LineTest = { name: string; lines: readonly string[] };

// O(n) in code length
// INV: models in strict JSON mode may emit no escape sequences, so code arrives as one string per source line; trailing spaces and leading/trailing blank lines are dropped, indentation is kept; null if empty or over CODE_MAX_CHARS
export function joinCodeLines(lines: readonly string[] | null): string | null {
  const ls = (lines ?? []).flatMap((l) => l.split(/\r?\n/)).map((l) => l.trimEnd());
  while (ls.length > 0 && ls[0] === "") ls.shift();
  while (ls.length > 0 && ls[ls.length - 1] === "") ls.pop();
  const code = ls.join("\n");
  return code === "" || code.length > CODE_MAX_CHARS ? null : code;
}

// O(n) in spec size
// INV: null unless every library is available on this host, there are 1..CODE_MAX_TESTS non-empty tests, and a reference solution is present; an empty starter is allowed
export function toCodeParts(starter: readonly string[] | null, libraries: readonly CodeLibrary[] | null, tests: readonly LineTest[] | null, solution: readonly string[] | null, available: readonly CodeLibrary[]): { spec: CodeSpec; answer: StoredCodeAnswer } | null {
  const libs = [...new Set(libraries ?? [])];
  if (libs.length > CODE_MAX_LIBRARIES || libs.some((l) => !available.includes(l))) return null;
  const ts: CodeTest[] = [];
  for (const t of tests ?? []) {
    const code = joinCodeLines(t.lines);
    const name = t.name.trim();
    if (code !== null && name !== "") ts.push({ name, code });
  }
  const ref = joinCodeLines(solution);
  if (ts.length === 0 || ts.length > CODE_MAX_TESTS || ref === null) return null;
  return { spec: { language: "python", starter: joinCodeLines(starter) ?? "", libraries: libs }, answer: { tests: ts, model: ref } };
}
