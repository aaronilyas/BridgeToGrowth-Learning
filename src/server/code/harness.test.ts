import { expect, test } from "bun:test";
import { HarnessRun, SANDBOX_PYTHON, parseHarnessLine } from "./core.ts";
import { HARNESS_PY } from "./harness.ts";

test("learner code that defines __eq__ is a policy error", async () => {
  if (!(await Bun.file(SANDBOX_PYTHON).exists())) return;
  const nonce = "eq-policy";
  const payload = JSON.stringify({
    mode: "run",
    nonce,
    libs: [],
    code: "class Box:\n    def __eq__(self, other):\n        return True\n",
    tests: [{ name: "spoof", code: "assert Box() == 0\n" }],
  });
  const proc = Bun.spawn([SANDBOX_PYTHON, "-I", "-B", "-c", HARNESS_PY], { stdin: new TextEncoder().encode(payload), stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  const status = await proc.exited;
  const parsed = parseHarnessLine(stdout, nonce, HarnessRun);
  if (!parsed) throw new Error(`harness status ${status}: ${stderr || stdout}`);
  expect(parsed.error ?? "").toContain("__eq__");
  expect(parsed.error ?? "").toContain("not allowed");
  expect(parsed.tests).toEqual([{ name: "spoof", passed: false, error: "not run: your code raised an error" }]);
});
