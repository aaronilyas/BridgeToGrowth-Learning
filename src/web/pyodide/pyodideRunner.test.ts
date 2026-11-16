import { expect, test } from "bun:test";
import { probeUserFetch, runPython } from "./runner.ts";
import { livePythonWorkers, prewarmPython, warmStatus } from "./warm.ts";

const indexURL = new URL("../../../node_modules/pyodide/", import.meta.url).pathname;
const spec = { language: "python" as const, starter: "", libraries: [] };

test.serial("an infinite loop is terminated by the timeout", async () => {
  const r = await runPython(spec, "while True:\n    pass\n", { indexURL, timeoutMs: 500, tests: [] });
  expect(r.started).toBe(true);
  expect(r.timedOut).toBe(true);
  expect(r.error ?? "").toContain("Time limit exceeded");
}, 120_000);

test.serial("a disallowed import is rejected", async () => {
  const r = await runPython(spec, "import os\n", { indexURL, tests: [{ name: "uses os", code: "assert True\n" }] });
  expect(r.started).toBe(true);
  expect(r.timedOut).toBe(false);
  expect(r.error ?? "").toContain("not allowed");
  expect(r.tests[0]?.passed).toBe(false);
}, 120_000);

test.serial("fetch from user code fails", async () => {
  const p = await probeUserFetch(indexURL);
  expect(p.fetch).toContain("network access is disabled");
  expect(p.jsFetch).not.toBe("allowed");
  expect(p.pyfetch).not.toBe("allowed");
  expect(`${p.jsFetch}\n${p.pyfetch}`).toMatch(/disabled|Error|Exception/i);
}, 120_000);

test.serial("a mounted question runs print(1) on the warm interpreter", async () => {
  expect(livePythonWorkers()).toBe(0);
  const release = prewarmPython(spec, { indexURL });
  try {
    expect(livePythonWorkers()).toBe(1);
    const cold = runPython(spec, "print(1)\n", { indexURL, tests: [] });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(livePythonWorkers()).toBe(1);
    const first = await cold;
    expect(first.stdout).toBe("1\n");
    expect(first.error).toBeNull();
    expect(first.started).toBe(true);
    expect(first.timedOut).toBe(false);
    const waitStarted = performance.now();
    while (warmStatus(indexURL, spec.libraries) !== "ready") {
      if (warmStatus(indexURL, spec.libraries) === "failed") throw new Error("warm boot failed");
      if (performance.now() - waitStarted > 60_000) throw new Error("warm boot timed out");
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const second = await runPython(spec, "print(1)\n", { indexURL, tests: [] });
    expect(second.stdout).toBe("1\n");
    expect(second.error).toBeNull();
    expect(second.timedOut).toBe(false);
    expect(second.durationMs).toBeLessThan(1_500);
    console.log(JSON.stringify({ clickWhileBootingMs: first.durationMs, warmClickMs: second.durationMs }));
  } finally {
    release();
    expect(livePythonWorkers()).toBe(0);
    expect(warmStatus(indexURL, spec.libraries)).toBe("absent");
  }
}, 120_000);
