import { beforeAll, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { runFigure } from "./runner.ts";

const indexURL = new URL("../../../.cache/pyodide/", import.meta.url).pathname;

beforeAll(() => {
  let files: string[] = [];
  try {
    files = readdirSync(indexURL);
  } catch {
    files = [];
  }
  if (!files.some((f) => f.startsWith("matplotlib-"))) throw new Error("matplotlib is not staged: run `bun scripts/fetch-pyodide.ts` first");
});

const PLOT = [
  "import numpy as np",
  "import matplotlib.pyplot as plt",
  "x = np.linspace(0, 2 * np.pi, 200)",
  "fig, ax = plt.subplots()",
  "ax.plot(x, np.sin(x), label='sin x')",
  "ax.set_title('One period of sine')",
  "ax.set_xlabel('x')",
  "ax.set_ylabel('sin x')",
  "ax.legend()",
].join("\n");

test.serial("plot code returns the current figure as SVG within the time limit", async () => {
  const r = await runFigure(PLOT, { indexURL });
  expect(r.error).toBeNull();
  expect(r.timedOut).toBe(false);
  expect(r.svg ?? "").toContain("<svg");
  expect(r.svg ?? "").not.toContain("<script");
}, 120_000);

test.serial("open() is refused in plot code", async () => {
  const r = await runFigure("plt.plot([0, 1])\nopen('/etc/passwd')\n", { indexURL });
  expect(r.svg).toBeNull();
  expect(r.error ?? "").toContain("'open' is not allowed");
}, 120_000);

test.serial("show() and savefig() are refused in plot code", async () => {
  const shown = await runFigure("plt.plot([0, 1])\nplt.show()\n", { indexURL });
  expect(shown.svg).toBeNull();
  expect(shown.error ?? "").toContain("'.show' is not allowed");
  const imported = await runFigure("from matplotlib.pyplot import savefig\nplt.plot([0, 1])\n", { indexURL });
  expect(imported.svg).toBeNull();
  expect(imported.error ?? "").toContain("not allowed");
}, 240_000);

test.serial("imports outside numpy and matplotlib.pyplot are refused", async () => {
  const os = await runFigure("import os\nplt.plot([0, 1])\n", { indexURL });
  expect(os.svg).toBeNull();
  expect(os.error ?? "").toContain("importing 'os' is not allowed");
  const cm = await runFigure("from matplotlib import cm\nplt.plot([0, 1])\n", { indexURL });
  expect(cm.svg).toBeNull();
  expect(cm.error ?? "").toContain("not allowed");
}, 240_000);

test.serial("code that draws nothing reports it instead of returning an empty figure", async () => {
  const r = await runFigure("x = np.arange(3)\n", { indexURL });
  expect(r.svg).toBeNull();
  expect(r.error).toBe("The code drew no figure.");
}, 120_000);
