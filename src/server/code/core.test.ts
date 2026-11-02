import { describe, expect, test } from "bun:test";
import { CODE_MEMORY_BYTES, buildCgroupJoin, buildSandboxArgv, planRunCgroup, planSandboxCgroups } from "./core.ts";

describe("sandbox cgroup builder", () => {
  test("lays out main and sandbox under the server's own cgroup, also after it moved into main", () => {
    const want = { own: "/sys/fs/cgroup/system.slice/btg.service", main: "/sys/fs/cgroup/system.slice/btg.service/main", sandbox: "/sys/fs/cgroup/system.slice/btg.service/sandbox" };
    expect(planSandboxCgroups("0::/system.slice/btg.service\n")).toEqual(want);
    expect(planSandboxCgroups("0::/system.slice/btg.service/main\n")).toEqual(want);
  });

  test("rejects cgroup v1, the root cgroup and traversal", () => {
    expect(planSandboxCgroups("12:pids:/system.slice/btg.service\n")).toBeNull();
    expect(planSandboxCgroups("0::/\n")).toBeNull();
    expect(planSandboxCgroups("0::/system.slice/../x\n")).toBeNull();
  });

  test("a run leaf caps pids, memory, swap and cpu", () => {
    const leaf = planRunCgroup("/cg/sandbox", "r1", CODE_MEMORY_BYTES);
    expect(leaf.dir).toBe("/cg/sandbox/r1");
    expect(leaf.procs).toBe("/cg/sandbox/r1/cgroup.procs");
    expect(leaf.kill).toBe("/cg/sandbox/r1/cgroup.kill");
    expect(Object.fromEntries(leaf.limits)).toEqual({ "/cg/sandbox/r1/pids.max": "64", "/cg/sandbox/r1/memory.max": String(512 * 1024 * 1024), "/cg/sandbox/r1/memory.swap.max": "0", "/cg/sandbox/r1/cpu.max": "100000 100000" });
  });

  test("the join helper sits between prlimit and bwrap and passes the procs path as an argument", () => {
    const join = buildCgroupJoin("/cg/sandbox/r1/cgroup.procs");
    const argv = buildSandboxArgv("/usr/bin/prlimit", "/usr/bin/bwrap", "pass", join);
    const sep = argv.indexOf("--");
    expect(argv[0]).toBe("/usr/bin/prlimit");
    expect(argv.slice(sep + 1, sep + 1 + join.length)).toEqual(join);
    expect(argv[sep + 1 + join.length]).toBe("/usr/bin/bwrap");
    expect(join.at(-1)).toBe("/cg/sandbox/r1/cgroup.procs");
    expect(join[0]).toBe("/usr/bin/python3");
  });
});
