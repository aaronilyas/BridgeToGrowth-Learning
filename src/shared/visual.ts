import { z } from "zod";
import { EXPR_CONSTANTS, EXPR_FUNCTIONS, EXPR_MAX_CHARS, parseExpr } from "./expr.ts";

// A visual is a fenced block whose info string is plot, scene or diagram. The model writes its source; the client renders it.

export const VISUAL_KINDS = ["plot", "scene", "diagram"] as const;
export type VisualKind = (typeof VISUAL_KINDS)[number];

export const PLOT_MAX_LINES = 60;
export const PLOT_MAX_CHARS = 5000;
// SEC: the only modules plot code may import; the figure harness enforces the same list
export const PLOT_MODULES = ["numpy", "matplotlib.pyplot"] as const;
export const DIAGRAM_MAX_LINES = 40;
export const DIAGRAM_MAX_CHARS = 4000;
export const SCENE_MAX_CHARS = 8000;
export const SCENE_MAX_OBJECTS = 20;
export const SCENE_MAX_STEPS = 12;
export const SCENE_MAX_PARAMS = 3;
export const STEP_MAX_SECONDS = 3;

export type Fence = { kind: VisualKind | null; line: number; from: number; to: number; closed: boolean; body: string; mark: string };

const OPEN_RE = /^( {0,3})(`{3,}|~{3,})(.*)$/;
const KIND_SET: ReadonlySet<string> = new Set(VISUAL_KINDS);

// O(1)
function kindOf(info: string): VisualKind | null {
  const word = info.trim().split(/\s+/, 1)[0] ?? "";
  return KIND_SET.has(word) ? (word as VisualKind) : null;
}

// O(n) in text length
// INV: CommonMark fences that open at the top level (at most 3 spaces of indent), in order; an unclosed fence runs to the end of the text; line is 1-based; body has the opening indent removed and no closing line
export function listFences(text: string): Fence[] {
  const lines = text.split("\n");
  const out: Fence[] = [];
  let offset = 0;
  let i = 0;
  const starts: number[] = [];
  for (const l of lines) {
    starts.push(offset);
    offset += l.length + 1;
  }
  while (i < lines.length) {
    const m = OPEN_RE.exec(lines[i] ?? "");
    const mark = m?.[2] ?? "";
    const info = m?.[3] ?? "";
    if (!m || (mark.startsWith("`") && info.includes("`"))) {
      i++;
      continue;
    }
    const indent = (m[1] ?? "").length;
    const close = new RegExp(`^ {0,3}${mark[0] === "`" ? "`" : "~"}{${mark.length},}\\s*$`);
    let j = i + 1;
    while (j < lines.length && !close.test(lines[j] ?? "")) j++;
    const closed = j < lines.length;
    const body = lines.slice(i + 1, j).map((l) => l.replace(new RegExp(`^ {0,${indent}}`), "")).join("\n");
    const last = closed ? j : lines.length - 1;
    out.push({ kind: kindOf(info), line: i + 1, from: starts[i] ?? 0, to: Math.min(text.length, (starts[last] ?? 0) + (lines[last]?.length ?? 0)), closed, body, mark });
    i = last + 1;
  }
  return out;
}

// O(n) in text length
export function firstVisual(text: string): Fence | null {
  return listFences(text).find((f) => f.kind !== null) ?? null;
}

// O(n) in text length
// INV: the first keep visual fences (0 or 1) are kept as written; every later visual fence is removed with its lines; other fences and prose are unchanged
export function limitVisuals(text: string, keep: number = 1): string {
  const extra = listFences(text).filter((f) => f.kind !== null).slice(keep);
  let out = text;
  for (const f of extra.reverse()) out = out.slice(0, f.from) + out.slice(Math.min(out.length, f.to + 1));
  return extra.length > 0 ? out.replace(/\n{3,}/g, "\n\n").trimEnd() : out;
}

// O(n) in text length
// INV: the server's view of a finished turn: at most one visual, and that visual is closed, so the client runs it instead of showing a placeholder
export function settleVisuals(text: string, keep: number = 1): string {
  const kept = limitVisuals(text, keep);
  const v = firstVisual(kept);
  if (v === null || v.closed) return kept;
  return `${kept.replace(/\n*$/, "")}\n${v.mark}`;
}

// O(n) in text length
// INV: fn sees each stretch of text outside fenced code, in order; fenced code is copied through unchanged
export function mapOutsideFences(text: string, fn: (prose: string) => string): string {
  let out = "";
  let at = 0;
  for (const f of listFences(text)) {
    out += fn(text.slice(at, f.from)) + text.slice(f.from, f.to);
    at = f.to;
  }
  return out + fn(text.slice(at));
}

// O(n) in source length
// INV: null when the source is within the line and character limits; the import policy itself is enforced by the figure harness
export function checkPlot(source: string): string | null {
  if (source.trim() === "") return "The plot has no code.";
  if (source.length > PLOT_MAX_CHARS || source.trimEnd().split("\n").length > PLOT_MAX_LINES) return `Plot code is limited to ${PLOT_MAX_LINES} lines.`;
  return null;
}

const DIAGRAM_START = /^(?:flowchart|graph|stateDiagram(?:-v2)?|sequenceDiagram)\b/;

// O(n) in source length
// SEC: init directives and front matter can change Mermaid's configuration, so they are refused; only flowchart, state and sequence diagrams are accepted
export function checkDiagram(source: string): string | null {
  if (source.length > DIAGRAM_MAX_CHARS || source.trimEnd().split("\n").length > DIAGRAM_MAX_LINES) return `A diagram is limited to ${DIAGRAM_MAX_LINES} lines.`;
  if (/%%\s*\{/.test(source)) return "Diagram directives are not allowed.";
  const first = source.split("\n").map((l) => l.trim()).find((l) => l !== "" && !l.startsWith("%%")) ?? "";
  if (first === "---") return "Diagram front matter is not allowed.";
  if (!DIAGRAM_START.test(first)) return "Only flowchart, stateDiagram and sequenceDiagram diagrams are supported.";
  return null;
}

// O(n) in source length
// SEC: interaction lines (click, href, callback, link) are dropped before Mermaid sees the text; nothing in a diagram can act
export function inertDiagram(source: string): string {
  return source
    .split("\n")
    .filter((l) => !/^\s*(?:click|href|callback|link|links)\s/i.test(l))
    .join("\n");
}

const RESERVED: ReadonlySet<string> = new Set<string>(["x", ...EXPR_FUNCTIONS, ...EXPR_CONSTANTS]);
const Id = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,23}$/);
const Num = z.number().finite();
const Coord = z.union([Num, z.string().max(EXPR_MAX_CHARS)]);
const Pair = z.tuple([Coord, Coord]);
const Range = z.tuple([Num, Num]);
export const SCENE_COLORS = ["accent", "accent-2", "text", "muted", "danger"] as const;
const Color = z.enum(SCENE_COLORS).optional();
const Tex = (max: number): z.ZodString => z.string().min(1).max(max);

export const SceneObject = z.discriminatedUnion("type", [
  z.strictObject({ id: Id, type: z.literal("axes"), grid: z.boolean().optional(), xLabel: Tex(40).optional(), yLabel: Tex(40).optional(), color: Color }),
  z.strictObject({ id: Id, type: z.literal("graph"), fn: z.string().min(1).max(EXPR_MAX_CHARS), domain: Range.optional(), color: Color }),
  z.strictObject({ id: Id, type: z.literal("point"), at: Pair, label: Tex(40).optional(), color: Color }),
  z.strictObject({ id: Id, type: z.literal("vector"), from: Pair.optional(), to: Pair, label: Tex(40).optional(), color: Color }),
  z.strictObject({ id: Id, type: z.literal("line"), from: Pair, to: Pair, color: Color }),
  z.strictObject({ id: Id, type: z.literal("circle"), center: Pair, r: Coord, color: Color }),
  z.strictObject({ id: Id, type: z.literal("polygon"), points: z.array(Pair).min(3).max(12), color: Color }),
  z.strictObject({ id: Id, type: z.literal("label"), at: Pair, text: Tex(80), color: Color }),
]);
export type SceneObject = z.infer<typeof SceneObject>;

export const SceneParam = z.strictObject({ name: z.string().regex(/^[a-z][a-z0-9]{0,11}$/), min: Num, max: Num, step: Num.positive(), value: Num.optional(), label: Tex(40).optional() });
export type SceneParam = z.infer<typeof SceneParam>;

const Timing = { duration: z.number().min(0).max(STEP_MAX_SECONDS), caption: z.string().min(1).max(160).optional() };
export const SceneStep = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("create"), id: Id, ...Timing }),
  z.strictObject({ action: z.literal("fadeIn"), id: Id, ...Timing }),
  z.strictObject({ action: z.literal("fadeOut"), id: Id, ...Timing }),
  z.strictObject({ action: z.literal("indicate"), id: Id, ...Timing }),
  z.strictObject({ action: z.literal("transform"), id: Id, target: Id, ...Timing }),
  z.strictObject({ action: z.literal("moveTo"), id: Id, to: Pair, ...Timing }),
  z.strictObject({ action: z.literal("setParam"), param: z.string(), value: Num, ...Timing }),
]);
export type SceneStep = z.infer<typeof SceneStep>;

const MOVABLE: ReadonlySet<SceneObject["type"]> = new Set(["point", "label", "circle", "vector"]);

// O(n) in the object's points
// INV: every coordinate the object holds (not a graph's fn), in a fixed order
export function listSceneCoords(o: SceneObject): (number | string)[] {
  if (o.type === "point" || o.type === "label") return [...o.at];
  if (o.type === "vector") return [...(o.from ?? [0, 0]), ...o.to];
  if (o.type === "line") return [...o.from, ...o.to];
  if (o.type === "circle") return [...o.center, o.r];
  if (o.type === "polygon") return o.points.flat();
  return [];
}

export const Scene = z
  .strictObject({
    width: z.int().min(200).max(960),
    height: z.int().min(120).max(720),
    axes: z.strictObject({ x: Range, y: Range }).optional(),
    params: z.array(SceneParam).max(SCENE_MAX_PARAMS).optional(),
    objects: z.array(SceneObject).min(1).max(SCENE_MAX_OBJECTS),
    steps: z.array(SceneStep).max(SCENE_MAX_STEPS),
  })
  .superRefine((s, ctx) => {
    const issue = (path: (string | number)[], message: string): void => ctx.addIssue({ code: "custom", path, message });
    const params = s.params ?? [];
    const names = params.map((p) => p.name);
    params.forEach((p, i) => {
      if (RESERVED.has(p.name) || names.indexOf(p.name) !== i) issue(["params", i, "name"], `param name '${p.name}' is reserved or repeated`);
      if (!(p.min < p.max) || (p.max - p.min) / p.step > 10_000) issue(["params", i], "param needs min < max and at most 10000 steps");
      if (p.value !== undefined && (p.value < p.min || p.value > p.max)) issue(["params", i, "value"], "param value is outside min..max");
    });
    for (const [k, r] of Object.entries(s.axes ?? {})) if (!(r[0] < r[1])) issue(["axes", k], "axis range needs min < max");
    const byId = new Map<string, SceneObject>();
    s.objects.forEach((o, i) => {
      if (byId.has(o.id)) issue(["objects", i, "id"], `id '${o.id}' is repeated`);
      byId.set(o.id, o);
      if (o.type === "graph") {
        const r = parseExpr(o.fn, ["x", ...names]);
        if (!r.ok) issue(["objects", i, "fn"], r.error);
        if (o.domain && !(o.domain[0] < o.domain[1])) issue(["objects", i, "domain"], "domain needs min < max");
      }
      for (const c of listSceneCoords(o)) {
        if (typeof c !== "string") continue;
        const r = parseExpr(c, names);
        if (!r.ok) issue(["objects", i], r.error);
      }
    });
    s.steps.forEach((st, i) => {
      if (st.action === "setParam") {
        const p = params.find((q) => q.name === st.param);
        if (!p) issue(["steps", i, "param"], `unknown param '${st.param}'`);
        else if (st.value < p.min || st.value > p.max) issue(["steps", i, "value"], "value is outside the param range");
        return;
      }
      const o = byId.get(st.id);
      if (!o) return issue(["steps", i, "id"], `unknown object '${st.id}'`);
      if (st.action === "transform" && (!byId.has(st.target) || st.target === st.id)) issue(["steps", i, "target"], `unknown or same target '${st.target}'`);
      if (st.action === "moveTo") {
        if (!MOVABLE.has(o.type)) issue(["steps", i, "id"], `a ${o.type} cannot move`);
        for (const c of st.to) if (typeof c === "string" && !parseExpr(c, names).ok) issue(["steps", i, "to"], "bad coordinate expression");
      }
    });
  });
export type Scene = z.infer<typeof Scene>;

export type SceneResult = { ok: true; scene: Scene } | { ok: false; error: string };

// O(n) in source length
// INV: ok only for JSON that passes the strict Scene schema, including every expression and reference
export function parseScene(source: string): SceneResult {
  if (source.length > SCENE_MAX_CHARS) return { ok: false, error: "The scene is too long." };
  let raw: unknown;
  try {
    raw = JSON.parse(source);
  } catch {
    return { ok: false, error: "The scene is not valid JSON." };
  }
  const r = Scene.safeParse(raw);
  if (r.success) return { ok: true, scene: r.data };
  const first = r.error.issues[0];
  return { ok: false, error: first ? `${first.path.join(".") || "scene"}: ${first.message}` : "The scene is invalid." };
}
