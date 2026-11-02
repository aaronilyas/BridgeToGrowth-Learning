import { expect, test } from "bun:test";
import { probeUserFetch, runPython } from "./runner.ts";

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
