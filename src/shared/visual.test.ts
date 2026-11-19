import { expect, test } from "bun:test";
import { VISUAL_RULE } from "./markdown.ts";
import { checkDiagram, checkPlot, firstVisual, limitVisuals, parseScene, settleVisuals, type Scene } from "./visual.ts";

const BASE: Scene = {
  width: 480,
  height: 300,
  axes: { x: [-3, 3], y: [-1, 5] },
  params: [{ name: "a", min: 0.5, max: 2, step: 0.1, value: 1 }],
  objects: [
    { id: "ax", type: "axes", grid: true, xLabel: "x", yLabel: "y" },
    { id: "f", type: "graph", fn: "a*x^2", color: "accent" },
    { id: "g", type: "graph", fn: "x + 1", domain: [-2, 2] },
    { id: "p", type: "point", at: [1, "a"], label: "(1, a)" },
    { id: "v", type: "vector", from: [0, 0], to: [1, 2] },
    { id: "l", type: "line", from: [-1, 0], to: [1, 0] },
    { id: "c", type: "circle", center: [0, 0], r: "a" },
    { id: "q", type: "polygon", points: [[0, 0], [1, 0], [0, 1]] },
    { id: "t", type: "label", at: [-2, 4], text: "y = a x^2" },
  ],
  steps: [
    { action: "create", id: "f", duration: 1.5, caption: "The parabola opens upward." },
    { action: "fadeIn", id: "p", duration: 1 },
    { action: "indicate", id: "p", duration: 0.5 },
    { action: "transform", id: "f", target: "g", duration: 2 },
    { action: "moveTo", id: "p", to: [2, "a*4"], duration: 1 },
    { action: "fadeOut", id: "t", duration: 1 },
    { action: "setParam", param: "a", value: 2, duration: 3 },
  ],
};

// O(n) in scene size
function errorOf(patch: (s: Scene) => unknown): string {
  const r = parseScene(JSON.stringify(patch(structuredClone(BASE))));
  return r.ok ? "ok" : r.error;
}

test("a scene with every object type and every step action validates", () => {
  const r = parseScene(JSON.stringify(BASE));
  expect(r.ok).toBe(true);
  expect(errorOf((s) => ({ width: s.width, height: s.height, objects: [{ id: "only", type: "point", at: [0, 0] }], steps: [] }))).toBe("ok");
});

test("the example scene in VISUAL_RULE validates against the schema", () => {
  const body = /```scene\n([\s\S]*?)\n```/.exec(VISUAL_RULE)?.[1] ?? "";
  expect(body.split("\n").length).toBe(10);
  expect(parseScene(body).ok).toBe(true);
});

test("the scene schema is strict about shape, types and references", () => {
  expect(parseScene("{not json").ok).toBe(false);
  expect(errorOf((s) => ({ ...s, extra: 1 }))).not.toBe("ok");
  expect(errorOf((s) => ({ ...s, objects: [...s.objects, { id: "z", type: "sprite", at: [0, 0] }] }))).not.toBe("ok");
  expect(errorOf((s) => ({ ...s, objects: [...s.objects, { id: "z", type: "point", at: [0, 0], onclick: "x" }] }))).not.toBe("ok");
  expect(errorOf((s) => ({ ...s, objects: [...s.objects, { id: "z", type: "point", at: [0, 0], color: "red" }] }))).not.toBe("ok");
  expect(errorOf((s) => ({ ...s, objects: [...s.objects, { id: "f", type: "point", at: [0, 0] }] }))).toContain("repeated");
  expect(errorOf((s) => ({ ...s, steps: [{ action: "fadeIn", id: "nope", duration: 1 }] }))).toContain("unknown object");
  expect(errorOf((s) => ({ ...s, steps: [{ action: "transform", id: "f", target: "f", duration: 1 }] }))).toContain("target");
  expect(errorOf((s) => ({ ...s, steps: [{ action: "moveTo", id: "f", to: [0, 0], duration: 1 }] }))).toContain("cannot move");
  expect(errorOf((s) => ({ ...s, steps: [{ action: "setParam", param: "b", value: 1, duration: 1 }] }))).toContain("unknown param");
  expect(errorOf((s) => ({ ...s, steps: [{ action: "setParam", param: "a", value: 9, duration: 1 }] }))).toContain("range");
  expect(errorOf((s) => ({ ...s, steps: [{ action: "explode", id: "f", duration: 1 }] }))).not.toBe("ok");
  expect(errorOf((s) => ({ ...s, steps: [{ action: "fadeIn", id: "f" }] }))).not.toBe("ok");
});

test("the scene schema enforces its limits", () => {
  const point = (i: number): unknown => ({ id: `p${i}`, type: "point", at: [0, 0] });
  expect(errorOf((s) => ({ ...s, objects: Array.from({ length: 20 }, (_, i) => point(i)), steps: [] }))).toBe("ok");
  expect(errorOf((s) => ({ ...s, objects: Array.from({ length: 21 }, (_, i) => point(i)), steps: [] }))).not.toBe("ok");
  expect(errorOf((s) => ({ ...s, objects: [], steps: [] }))).not.toBe("ok");
  const fade = { action: "fadeIn", id: "p", duration: 1 };
  expect(errorOf((s) => ({ ...s, steps: Array(12).fill(fade) }))).toBe("ok");
  expect(errorOf((s) => ({ ...s, steps: Array(13).fill(fade) }))).not.toBe("ok");
  expect(errorOf((s) => ({ ...s, steps: [{ ...fade, duration: 3 }] }))).toBe("ok");
  expect(errorOf((s) => ({ ...s, steps: [{ ...fade, duration: 3.01 }] }))).not.toBe("ok");
  expect(errorOf((s) => ({ ...s, steps: [{ ...fade, duration: -1 }] }))).not.toBe("ok");
  const param = (name: string): unknown => ({ name, min: 0, max: 3, step: 0.1 });
  expect(errorOf((s) => ({ ...s, params: ["a", "b", "c"].map(param) }))).toBe("ok");
  expect(errorOf((s) => ({ ...s, params: ["a", "b", "c", "d"].map(param) }))).not.toBe("ok");
  expect(errorOf((s) => ({ ...s, params: [{ name: "a", min: 1, max: 0, step: 0.1 }] }))).toContain("min < max");
  expect(errorOf((s) => ({ ...s, params: [{ name: "a", min: 0, max: 1, step: 0 }] }))).not.toBe("ok");
  expect(errorOf((s) => ({ ...s, params: [{ name: "a", min: 0, max: 1, step: 0.1, value: 2 }] }))).toContain("outside");
  expect(errorOf((s) => ({ ...s, params: [param("a"), param("sin")] }))).toContain("reserved");
  expect(errorOf((s) => ({ ...s, params: [param("a"), param("a")] }))).toContain("repeated");
  expect(errorOf((s) => ({ ...s, width: 2000 }))).not.toBe("ok");
  expect(errorOf((s) => ({ ...s, height: 50 }))).not.toBe("ok");
  expect(errorOf((s) => ({ ...s, axes: { x: [1, -1], y: [0, 1] } }))).toContain("min < max");
  expect(errorOf((s) => ({ ...s, objects: [{ id: "t", type: "label", at: [0, 0], text: "x".repeat(80) }], steps: [] }))).toBe("ok");
  expect(errorOf((s) => ({ ...s, objects: [{ id: "t", type: "label", at: [0, 0], text: "x".repeat(81) }], steps: [] }))).not.toBe("ok");
  expect(parseScene(" ".repeat(8001)).ok).toBe(false);
});

test("scene expressions go through the whitelisted parser", () => {
  expect(errorOf((s) => ({ ...s, objects: [{ id: "f", type: "graph", fn: "constructor" }], steps: [] }))).toContain("unknown name");
  expect(errorOf((s) => ({ ...s, objects: [{ id: "f", type: "graph", fn: "Math.sin(x)" }], steps: [] }))).not.toBe("ok");
  expect(errorOf((s) => ({ ...s, objects: [{ id: "p", type: "point", at: ["x", 0] }], steps: [] }))).toContain("unknown name 'x'");
  expect(errorOf((s) => ({ ...s, objects: [{ id: "p", type: "point", at: ["alert(1)", 0] }], steps: [] }))).not.toBe("ok");
  expect(errorOf((s) => ({ ...s, steps: [{ action: "moveTo", id: "p", to: ["window", 0], duration: 1 }] }))).not.toBe("ok");
});

test("plot and diagram sources are held to their line limits and diagram types", () => {
  expect(checkPlot("import numpy as np\n".repeat(60))).toBeNull();
  expect(checkPlot("x = 1\n".repeat(61))).not.toBeNull();
  expect(checkPlot("  \n")).not.toBeNull();
  expect(checkDiagram(`flowchart TD\n${"  A --> B\n".repeat(39)}`)).toBeNull();
  expect(checkDiagram(`flowchart TD\n${"  A --> B\n".repeat(40)}`)).not.toBeNull();
  expect(checkDiagram("sequenceDiagram\n  A->>B: hi")).toBeNull();
  expect(checkDiagram("%% note\nstateDiagram-v2\n  [*] --> S")).toBeNull();
  expect(checkDiagram("pie\n  \"a\": 1")).not.toBeNull();
  expect(checkDiagram("%%{init: {\"securityLevel\": \"loose\"}}%%\nflowchart TD\n  A --> B")).not.toBeNull();
  expect(checkDiagram("---\nconfig:\n  htmlLabels: true\n---\nflowchart TD\n  A --> B")).not.toBeNull();
});

test("a second visual in one turn is dropped and the first is kept as written", () => {
  const text = "Look at the curve.\n\n```plot\nplt.plot([0, 1])\n```\n\nNow the flow.\n\n```diagram\nflowchart TD\n  A --> B\n```\n\nAnd code:\n\n```python\nprint(1)\n```\n\nWhat changes?";
  const out = limitVisuals(text);
  expect(out).toContain("```plot\nplt.plot([0, 1])\n```");
  expect(out).not.toContain("```diagram");
  expect(out).toContain("```python\nprint(1)\n```");
  expect(out.endsWith("What changes?")).toBe(true);
  expect(limitVisuals("Just prose.\n\n```python\nx = 1\n```")).toBe("Just prose.\n\n```python\nx = 1\n```");
  expect(limitVisuals(out)).toBe(out);
  expect(limitVisuals(text, 0)).not.toContain("```plot");
});

test("a finished turn closes its open visual so it runs instead of waiting", () => {
  const open = "See this.\n\n```plot\nplt.plot([0, 1])";
  expect(firstVisual(open)?.closed).toBe(false);
  const settled = settleVisuals(open);
  expect(settled).toBe("See this.\n\n```plot\nplt.plot([0, 1])\n```");
  expect(firstVisual(settled)).toMatchObject({ kind: "plot", closed: true, body: "plt.plot([0, 1])" });
  expect(settleVisuals("```scene\n{}\n```\n\n```plot\nx")).toBe("```scene\n{}\n```");
});
