import type { CodeLibrary, CodeTest } from "../../shared/code.ts";
import { HttpError } from "../http.ts";
import { HARNESS_PY } from "./harness.ts";
import { HarnessProbe, HarnessRun, MAX_CONCURRENT_RUNS, RUN_TIMEOUT_MS, SANDBOX_PYTHON, STDOUT_CAP, buildProbePayload, buildRunPayload, buildSandboxArgv, parseHarnessLine, settleRun, toAvailableLibraries, type CodeRun, type SandboxOutcome } from "./core.ts";

export type CodeRuntime = { enabled: boolean; libraries: CodeLibrary[] };

const TOOL_PATH = "/usr/bin:/bin";
let running = 0;
let runtime: Promise<CodeRuntime> | null = null;

// O(1)
// SEC: tools resolve only from system directories, never from the caller's PATH
function locateSandbox(): string[] | null {
  const bwrap = Bun.which("bwrap", { PATH: TOOL_PATH });
  const prlimit = Bun.which("prlimit", { PATH: TOOL_PATH });
  if (!bwrap || !prlimit || !Bun.file(SANDBOX_PYTHON).size) return null;
  return buildSandboxArgv(prlimit, bwrap, HARNESS_PY);
}

// O(output) bounded by STDOUT_CAP
// SEC: argv only, no shell; empty env (bwrap sets the sandbox env); stdin carries only the payload; stderr is discarded; SIGKILL on timeout or oversized output
async function spawnSandbox(argv: string[], payload: string): Promise<SandboxOutcome> {
  const started = performance.now();
  const proc = Bun.spawn(argv, { env: {}, stdin: new TextEncoder().encode(payload), stdout: "pipe", stderr: "ignore", timeout: RUN_TIMEOUT_MS, killSignal: "SIGKILL" });
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of proc.stdout) {
    size += chunk.length;
    if (size > STDOUT_CAP) {
      proc.kill("SIGKILL");
      break;
    }
    chunks.push(chunk);
  }
  await proc.exited;
  const durationMs = Math.round(performance.now() - started);
  return { stdout: new TextDecoder("utf-8", { fatal: false }).decode(Buffer.concat(chunks)), timedOut: proc.signalCode === "SIGKILL" && durationMs >= RUN_TIMEOUT_MS - 50, durationMs };
}

// O(1) amortized; one sandbox launch on first call
// INV: memoized; code questions are offered only when the sandbox starts and reports which catalog libraries this host has installed
export function codeRuntime(): Promise<CodeRuntime> {
  runtime ??= (async () => {
    const argv = locateSandbox();
    if (!argv) {
      console.error("code: sandbox unavailable (needs bwrap, prlimit and /usr/bin/python3); code questions are disabled");
      return { enabled: false, libraries: [] };
    }
    const nonce = crypto.randomUUID();
    const out = await spawnSandbox(argv, buildProbePayload(nonce)).catch(() => null);
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
// SEC: the caller supplies only code; libraries and tests come from the stored question; at most MAX_CONCURRENT_RUNS sandboxes run at once
export async function runInSandbox(libs: readonly CodeLibrary[], code: string, tests: readonly CodeTest[]): Promise<CodeRun> {
  const rt = await codeRuntime();
  const argv = rt.enabled ? locateSandbox() : null;
  if (!argv) throw new HttpError(503, "sandbox_unavailable");
  if (running >= MAX_CONCURRENT_RUNS) throw new HttpError(429, "rate_limited");
  running += 1;
  try {
    const nonce = crypto.randomUUID();
    const out = await spawnSandbox(argv, buildRunPayload(nonce, libs, code, tests));
    return settleRun(out, parseHarnessLine(out.stdout, nonce, HarnessRun), tests);
  } finally {
    running -= 1;
  }
}
