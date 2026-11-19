import { evalExpr, parseExpr, type Expr } from "../../shared/expr.ts";
import { listSceneCoords, type Scene, type SceneObject, type SceneStep } from "../../shared/visual.ts";

export type XY = [number, number];
export type Geom =
  | { k: "axes" }
  | { k: "pts"; pts: XY[]; closed: boolean }
  | { k: "dot"; at: XY }
  | { k: "arrow"; from: XY; to: XY }
  | { k: "ell"; c: XY; rx: number; ry: number }
  | { k: "tex"; at: XY };

export type SceneState = { opacity: Record<string, number>; draw: Record<string, number>; pulse: Record<string, number>; moved: Record<string, XY>; params: Record<string, number>; morph: { id: string; target: string; t: number } | null };
export type View = { x: XY; y: XY; width: number; height: number };
export type Compiled = { scene: Scene; view: View; exprs: ReadonlyMap<string, Expr> };

const SAMPLES = 200;

// O(n) in scene size
// INV: every expression string in the scene is parsed once; the schema has already accepted each of them
export function compileScene(scene: Scene): Compiled {
  const names = (scene.params ?? []).map((p) => p.name);
  const exprs = new Map<string, Expr>();
  const add = (src: number | string, vars: string[]): void => {
    if (typeof src !== "string" || exprs.has(src)) return;
    const r = parseExpr(src, vars);
    if (r.ok) exprs.set(src, r.expr);
  };
  for (const o of scene.objects) {
    if (o.type === "graph") add(o.fn, ["x", ...names]);
    for (const v of listSceneCoords(o)) add(v, names);
  }
  for (const s of scene.steps) if (s.action === "moveTo") for (const c of s.to) add(c, names);
  const x: XY = scene.axes?.x ?? [-5, 5];
  const half = ((x[1] - x[0]) * scene.height) / scene.width / 2;
  return { scene, view: { x, y: scene.axes?.y ?? [-half, half], width: scene.width, height: scene.height }, exprs };
}

// O(1)
function ease(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
}

// O(1)
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// O(expr)
// INV: a coordinate is a number or an expression in the params; anything unreadable is NaN, which draws nothing
export function coordOf(c: Compiled, v: number | string, env: Record<string, number>): number {
  if (typeof v === "number") return v;
  const e = c.exprs.get(v);
  return e ? evalExpr(e, env) : Number.NaN;
}

// O(objects + steps)
// INV: an object named by a create or fadeIn step, or used as a transform target, starts hidden; every other object starts visible
export function initialState(scene: Scene): SceneState {
  const hidden = new Set<string>();
  for (const s of scene.steps) {
    if (s.action === "create" || s.action === "fadeIn") hidden.add(s.id);
    if (s.action === "transform") hidden.add(s.target);
  }
  const opacity: Record<string, number> = {};
  for (const o of scene.objects) opacity[o.id] = hidden.has(o.id) ? 0 : 1;
  const params: Record<string, number> = {};
  for (const p of scene.params ?? []) params[p.name] = p.value ?? p.min;
  return { opacity, draw: {}, pulse: {}, moved: {}, params, morph: null };
}

// O(1)
function anchorOf(c: Compiled, o: SceneObject, s: SceneState): XY {
  const m = s.moved[o.id];
  if (m) return m;
  const p = o.type === "point" || o.type === "label" ? o.at : o.type === "circle" ? o.center : o.type === "vector" ? o.to : [0, 0];
  return [coordOf(c, p[0], s.params), coordOf(c, p[1], s.params)];
}

// O(1)
// INV: t is the eased progress of this one step; t = 1 is the step's final frame
export function applyStep(c: Compiled, s: SceneState, step: SceneStep, t: number): SceneState {
  const n: SceneState = { ...s, opacity: { ...s.opacity }, draw: { ...s.draw }, pulse: { ...s.pulse }, moved: { ...s.moved }, params: { ...s.params }, morph: null };
  if (step.action === "setParam") {
    n.params[step.param] = lerp(s.params[step.param] ?? 0, step.value, t);
    return n;
  }
  const id = step.id;
  if (step.action === "create") {
    n.opacity[id] = 1;
    n.draw[id] = t;
  } else if (step.action === "fadeIn") n.opacity[id] = Math.max(s.opacity[id] ?? 0, t);
  else if (step.action === "fadeOut") n.opacity[id] = Math.min(s.opacity[id] ?? 1, 1 - t);
  else if (step.action === "indicate") n.pulse[id] = Math.sin(Math.PI * t);
  else if (step.action === "transform") {
    if (t >= 1) {
      n.opacity[id] = 0;
      n.opacity[step.target] = 1;
    } else n.morph = { id, target: step.target, t };
  } else {
    const o = c.scene.objects.find((x) => x.id === id);
    if (o) {
      const from = anchorOf(c, o, s);
      n.moved[id] = [lerp(from[0], coordOf(c, step.to[0], s.params), t), lerp(from[1], coordOf(c, step.to[1], s.params), t)];
    }
  }
  return n;
}

// O(steps)
// INV: the state after done steps have finished and step done is at progress t (0..1); done is clamped to 0..steps
export function frameAt(c: Compiled, done: number, t: number): SceneState {
  const steps = c.scene.steps;
  const k = Math.max(0, Math.min(done, steps.length));
  let s = initialState(c.scene);
  for (let i = 0; i < k; i++) {
    const step = steps[i];
    if (step) s = applyStep(c, s, step, 1);
  }
  const cur = steps[k];
  return cur && t > 0 ? applyStep(c, s, cur, ease(t)) : s;
}

// O(1)
export function toScreen(v: View, p: XY): XY {
  return [((p[0] - v.x[0]) / (v.x[1] - v.x[0])) * v.width, v.height - ((p[1] - v.y[0]) / (v.y[1] - v.y[0])) * v.height];
}

// O(SAMPLES) for a graph, O(1) otherwise
// INV: screen coordinates; a graph is sampled at SAMPLES fixed x positions so two graphs can be morphed point by point
export function geomOf(c: Compiled, o: SceneObject, s: SceneState): Geom {
  const env = s.params;
  const at = (p: readonly (number | string)[]): XY => toScreen(c.view, [coordOf(c, p[0] ?? Number.NaN, env), coordOf(c, p[1] ?? Number.NaN, env)]);
  const anchor = toScreen(c.view, anchorOf(c, o, s));
  switch (o.type) {
    case "axes":
      return { k: "axes" };
    case "graph": {
      const [a, b] = o.domain ?? c.view.x;
      const e = c.exprs.get(o.fn);
      const pts: XY[] = [];
      for (let i = 0; i <= SAMPLES; i++) {
        const x = a + ((b - a) * i) / SAMPLES;
        const y = e ? evalExpr(e, { ...env, x }) : Number.NaN;
        pts.push(toScreen(c.view, [x, y]));
      }
      return { k: "pts", pts, closed: false };
    }
    case "point":
      return { k: "dot", at: anchor };
    case "label":
      return { k: "tex", at: anchor };
    case "vector":
      return { k: "arrow", from: at(o.from ?? [0, 0]), to: anchor };
    case "line":
      return { k: "pts", pts: [at(o.from), at(o.to)], closed: false };
    case "circle": {
      const r = coordOf(c, o.r, env);
      return { k: "ell", c: anchor, rx: (r / (c.view.x[1] - c.view.x[0])) * c.view.width, ry: (r / (c.view.y[1] - c.view.y[0])) * c.view.height };
    }
    case "polygon":
      return { k: "pts", pts: o.points.map(at), closed: true };
  }
}

// O(n) in points
// INV: null when the two shapes cannot be morphed point by point; the caller then cross-fades them
export function morphGeom(a: Geom, b: Geom, t: number): Geom | null {
  const mix = (p: XY, q: XY): XY => [lerp(p[0], q[0], t), lerp(p[1], q[1], t)];
  if (a.k === "pts" && b.k === "pts" && a.pts.length === b.pts.length) return { k: "pts", pts: a.pts.map((p, i) => mix(p, b.pts[i] ?? p)), closed: a.closed };
  if (a.k === "dot" && b.k === "dot") return { k: "dot", at: mix(a.at, b.at) };
  if (a.k === "tex" && b.k === "tex") return { k: "tex", at: mix(a.at, b.at) };
  if (a.k === "arrow" && b.k === "arrow") return { k: "arrow", from: mix(a.from, b.from), to: mix(a.to, b.to) };
  if (a.k === "ell" && b.k === "ell") return { k: "ell", c: mix(a.c, b.c), rx: lerp(a.rx, b.rx, t), ry: lerp(a.ry, b.ry, t) };
  return null;
}

// O(n) in points
// INV: a non-finite or far off-screen sample breaks the line, so asymptotes are not joined across
export function pathOf(pts: readonly XY[], closed: boolean, height: number): string {
  let d = "";
  let pen = false;
  for (const [x, y] of pts) {
    if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(y) > height * 20) {
      pen = false;
      continue;
    }
    d += `${pen ? "L" : "M"}${x.toFixed(2)} ${y.toFixed(2)}`;
    pen = true;
  }
  return closed && d !== "" ? `${d}Z` : d;
}

// O(1)
// INV: the caption of the step in progress, else of the last finished step, else null
export function captionAt(scene: Scene, done: number, t: number): string | null {
  const i = t > 0 ? done : done - 1;
  return scene.steps[i]?.caption ?? null;
}
