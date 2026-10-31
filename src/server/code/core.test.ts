import { expect, test } from "bun:test";
import { buildSandboxArgv } from "./core.ts";

test("sandbox argv limits process count", () => {
  expect(buildSandboxArgv("/usr/bin/prlimit", "/usr/bin/bwrap", "harness")).toContain("--nproc=512");
});
