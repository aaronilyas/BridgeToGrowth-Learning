import type { CodeLibrary, CodeTest } from "../../shared/code.ts";
import { HttpError } from "../http.ts";
import { HARNESS_PY } from "./harness.ts";
import { runContained } from "./cgroup.ts";
import { CODE_MEMORY_BYTES, HarnessProbe, HarnessRun, MAX_CONCURRENT_RUNS, RUN_TIMEOUT_MS, SANDBOX_PYTHON, STDOUT_CAP, buildProbePayload, buildRunPayload, buildSandboxArgv, parseHarnessLine, settleRun, toAvailableLibraries, type CodeRun, type SandboxOutcome } from "./core.ts";

export type CodeRuntime = { enabled: boolean; libraries: CodeLibrary[] };

const TOOL_PATH = "/usr/bin:/bin";
const runningUsers = new Set<string>();
let runtime: Promise<CodeRuntime> | null = null;

// O(1)
// SEC: tools resolve only from system directories, never from the caller's PATH
function locateSandbox(): ((join: string[]) => string[]) | null {
  const bwrap = Bun.which("bwrap", { PATH: TOOL_PATH });
  const prlimit = Bun.which("prlimit", { PATH: TOOL_PATH });
  if (!bwrap || !prlimit || !Bun.file(SANDBOX_PYTHON).size) return null;
  return (join) => buildSandboxArgv(prlimit, bwrap, HARNESS_PY, join);
}

// O(output) bounded by STDOUT_CAP
// SEC: runs in its own cgroup leaf (runContained); stdin carries only the payload
async function spawnSandbox(build: (join: string[]) => string[], payload: string): Promise<SandboxOutcome> {
  const r = await runContained(build, { memoryBytes: CODE_MEMORY_BYTES, stdin: new TextEncoder().encode(payload), cap: STDOUT_CAP, timeoutMs: RUN_TIMEOUT_MS });
  return { stdout: new TextDecoder("utf-8", { fatal: false }).decode(r.out), timedOut: r.timedOut, durationMs: r.durationMs };
}

// O(1) amortized; one sandbox launch on first call
// INV: memoized; code questions are offered only when the sandbox starts and reports which catalog libraries this host has installed
export function codeRuntime(): Promise<CodeRuntime> {
  runtime ??= (async () => {
    const build = locateSandbox();
    if (!build) {
      console.error("code: sandbox unavailable (needs bwrap, prlimit and /usr/bin/python3); code questions are disabled");
      return { enabled: false, libraries: [] };
    }
    const nonce = crypto.randomUUID();
    const out = await spawnSandbox(build, buildProbePayload(nonce)).catch(() => null);
    const probe = out ? parseHarnessLine(out.stdout, nonce, HarnessProbe) : null;
    if (!probe) {
      console.error("code: sandbox failed to start; code questions are disabled");
      return { enabled: false, libraries: [] };
    }
    return { enabled: true, libraries: toAvailableLibraries(probe.available) };
  })();
  return runtime;
}

// O(code + output), one sandboxed process
// SEC: the caller supplies only code and whether dunder definitions are banned; libraries and tests come from the stored question; each user gets one run and global runs are bounded
export async function runInSandbox(uid: string, libs: readonly CodeLibrary[], code: string, tests: readonly CodeTest[], guardDefs: boolean = true): Promise<CodeRun> {
  const rt = await codeRuntime();
  const build = rt.enabled ? locateSandbox() : null;
  if (!build) throw new HttpError(503, "sandbox_unavailable");
  if (runningUsers.has(uid) || runningUsers.size >= MAX_CONCURRENT_RUNS) throw new HttpError(429, "rate_limited");
  runningUsers.add(uid);
  try {
    const nonce = crypto.randomUUID();
    const out = await spawnSandbox(build, buildRunPayload(nonce, libs, code, tests, guardDefs));
    return settleRun(out, parseHarnessLine(out.stdout, nonce, HarnessRun), tests);
  } finally {
    runningUsers.delete(uid);
  }
}
