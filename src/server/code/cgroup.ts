import { mkdir, readFile, rmdir, writeFile } from "node:fs/promises";
import { HttpError } from "../http.ts";
import { CGROUP_CONTROLLERS, SANDBOX_PYTHON, buildCgroupJoin, planRunCgroup, planSandboxCgroups, type RunCgroup, type SandboxCgroups } from "./core.ts";

export type ContainOptions = { memoryBytes: number; stdin: Uint8Array | null; cap: number; timeoutMs: number };
export type ContainedRun = { out: Uint8Array; exitCode: number; signaled: boolean; over: boolean; timedOut: boolean; durationMs: number };

const CLEANUP_TRIES = 100;
const CLEANUP_WAIT_MS = 10;
let layout: Promise<SandboxCgroups | null> | null = null;

// O(1) amortized; a few cgroupfs writes on first call
// INV: memoized and awaited before the first sandbox spawn, so the server is the only process in its cgroup when it moves into main/ (cgroup v2 forbids processes in inner nodes)
// SEC: needs Delegate=yes in btg.service; any failure returns null and every sandboxed tool reports itself unavailable rather than running without the cgroup
export function prepareSandboxCgroups(): Promise<SandboxCgroups | null> {
  layout ??= (async () => {
    try {
      const plan = planSandboxCgroups(await readFile("/proc/self/cgroup", "utf8"));
      if (!plan || !Bun.file(SANDBOX_PYTHON).size) throw new Error("no cgroup");
      await mkdir(plan.main, { recursive: true });
      await writeFile(`${plan.main}/cgroup.procs`, String(process.pid));
      await writeFile(`${plan.own}/cgroup.subtree_control`, CGROUP_CONTROLLERS);
      await mkdir(plan.sandbox, { recursive: true });
      await writeFile(`${plan.sandbox}/cgroup.subtree_control`, CGROUP_CONTROLLERS);
      return plan;
    } catch {
      console.error("sandbox: cgroup setup failed (needs a delegated cgroup v2 subtree, Delegate=yes, and /usr/bin/python3); sandboxed tools are disabled");
      return null;
    }
  })();
  return layout;
}

// O(1)
// INV: best effort; a leaf that is already gone has nothing left to kill
async function killLeaf(leaf: RunCgroup): Promise<void> {
  await writeFile(leaf.kill, "1").catch(() => undefined);
}

// O(1) bounded by CLEANUP_TRIES
// INV: kills whatever is left in the leaf, then retries rmdir until the kernel has reaped it
async function removeLeaf(leaf: RunCgroup): Promise<void> {
  await killLeaf(leaf);
  for (let i = 0; i < CLEANUP_TRIES; i++) {
    try {
      await rmdir(leaf.dir);
      return;
    } catch (e) {
      if ((e as { code?: string }).code === "ENOENT") return;
      await Bun.sleep(CLEANUP_WAIT_MS);
    }
  }
  console.error("sandbox: run cgroup cleanup failed");
}

// O(output) bounded by cap
// SEC: every run gets its own leaf under sandbox/ (pids.max, memory.max, memory.swap.max=0, cpu.max) and joins it before bwrap starts; argv only, no shell; empty env; stderr discarded
// SEC: on timeout or oversized output the whole leaf is killed through cgroup.kill, so no descendant outlives the run; the leaf is removed after exit
export async function runContained(build: (join: string[]) => string[], o: ContainOptions): Promise<ContainedRun> {
  const cg = await prepareSandboxCgroups();
  if (!cg) throw new HttpError(503, "sandbox_unavailable");
  const leaf = planRunCgroup(cg.sandbox, crypto.randomUUID(), o.memoryBytes);
  try {
    await mkdir(leaf.dir);
    for (const [file, value] of leaf.limits) await writeFile(file, value);
  } catch {
    await removeLeaf(leaf);
    console.error("sandbox: run cgroup setup failed");
    throw new HttpError(503, "sandbox_unavailable");
  }
  try {
    const started = performance.now();
    let timedOut = false;
    let over = false;
    const proc = Bun.spawn(build(buildCgroupJoin(leaf.procs)), { env: {}, stdin: o.stdin ?? "ignore", stdout: "pipe", stderr: "ignore" });
    const stop = (): void => {
      proc.kill("SIGKILL");
      void killLeaf(leaf);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      stop();
    }, o.timeoutMs);
    const chunks: Uint8Array[] = [];
    let size = 0;
    for await (const chunk of proc.stdout) {
      size += chunk.length;
      if (size > o.cap) {
        over = true;
        stop();
        break;
      }
      chunks.push(chunk);
    }
    const exitCode = await proc.exited;
    clearTimeout(timer);
    return { out: Buffer.concat(chunks), exitCode, signaled: proc.signalCode !== null, over, timedOut, durationMs: Math.round(performance.now() - started) };
  } finally {
    await removeLeaf(leaf);
  }
}
