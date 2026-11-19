import katex from "katex";
import { useMemo, type JSX } from "react";
import type { SCENE_COLORS, SceneObject } from "../../shared/visual.ts";
import { pathOf, toScreen, type Geom, type View } from "./sceneFrame.ts";

type SceneColor = (typeof SCENE_COLORS)[number];

const STROKE: Record<SceneColor, string> = { accent: "stroke-accent", "accent-2": "stroke-accent-2", text: "stroke-text", muted: "stroke-muted", danger: "stroke-danger" };
const FILL: Record<SceneColor, string> = { accent: "fill-accent", "accent-2": "fill-accent-2", text: "fill-text", muted: "fill-muted", danger: "fill-danger" };
const TEXT: Record<SceneColor, string> = { accent: "text-accent", "accent-2": "text-accent-2", text: "text-text", muted: "text-muted", danger: "text-danger" };
const DEFAULT: Record<SceneObject["type"], SceneColor> = { axes: "muted", graph: "accent", point: "accent-2", vector: "accent", line: "text", circle: "accent-2", polygon: "accent", label: "text" };

// O(1)
function colorOf(o: SceneObject): SceneColor {
  return o.color ?? DEFAULT[o.type];
}

// O(1)
function niceStep(span: number): number {
  const raw = span / 8;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const f = raw / mag;
  return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * mag;
}

// O(n) in label length
// SEC: KaTeX escapes its input and trust: false refuses \href, \url, \includegraphics and the \html* commands, so the markup holds no links, handlers or scripts
export function TexLabel({ tex, at, className }: { tex: string; at: [number, number]; className: string }): JSX.Element {
  const html = useMemo(() => katex.renderToString(tex, { throwOnError: false, trust: false, strict: "ignore", maxSize: 20, maxExpand: 200, output: "html" }), [tex]);
  return (
    <foreignObject x={at[0] + 6} y={at[1] - 26} width={200} height={32} className="overflow-visible">
      <div className={`whitespace-nowrap text-sm ${className}`} dangerouslySetInnerHTML={{ __html: html }} />
    </foreignObject>
  );
}

// O(ticks)
export function AxesShape({ o, view }: { o: Extract<SceneObject, { type: "axes" }>; view: View }): JSX.Element {
  const [ox, oy] = toScreen(view, [Math.min(Math.max(0, view.x[0]), view.x[1]), Math.min(Math.max(0, view.y[0]), view.y[1])]);
  const ticks = (r: [number, number]): number[] => {
    const s = niceStep(r[1] - r[0]);
    const out: number[] = [];
    for (let v = Math.ceil(r[0] / s) * s; v <= r[1] + 1e-9 && out.length < 30; v += s) if (Math.abs(v) > s / 1e6) out.push(Number(v.toPrecision(6)));
    return out;
  };
  const xs = ticks(view.x);
  const ys = ticks(view.y);
  const stroke = STROKE[colorOf(o)];
  return (
    <g className="text-[10px]">
      {o.grid && xs.map((v) => <line key={`gx${v}`} x1={toScreen(view, [v, 0])[0]} x2={toScreen(view, [v, 0])[0]} y1={0} y2={view.height} className="stroke-border" strokeWidth={0.5} />)}
      {o.grid && ys.map((v) => <line key={`gy${v}`} y1={toScreen(view, [0, v])[1]} y2={toScreen(view, [0, v])[1]} x1={0} x2={view.width} className="stroke-border" strokeWidth={0.5} />)}
      <line x1={0} x2={view.width} y1={oy} y2={oy} className={stroke} strokeWidth={1.2} />
      <line y1={0} y2={view.height} x1={ox} x2={ox} className={stroke} strokeWidth={1.2} />
      {xs.map((v) => {
        const x = toScreen(view, [v, 0])[0];
        return (
          <g key={`tx${v}`}>
            <line x1={x} x2={x} y1={oy - 3} y2={oy + 3} className={stroke} />
            <text x={x} y={Math.min(oy + 14, view.height - 2)} textAnchor="middle" className="fill-muted">{v}</text>
          </g>
        );
      })}
      {ys.map((v) => {
        const y = toScreen(view, [0, v])[1];
        return (
          <g key={`ty${v}`}>
            <line y1={y} y2={y} x1={ox - 3} x2={ox + 3} className={stroke} />
            <text x={Math.max(ox - 6, 18)} y={y + 3} textAnchor="end" className="fill-muted">{v}</text>
          </g>
        );
      })}
      {o.xLabel && <TexLabel tex={o.xLabel} at={[view.width - 40, oy - 4]} className="text-muted" />}
      {o.yLabel && <TexLabel tex={o.yLabel} at={[ox + 2, 24]} className="text-muted" />}
    </g>
  );
}

// O(points)
// INV: draw (0..1) reveals a stroke from its start; pulse (0..1) thickens and enlarges the shape for indicate
export function GeomShape({ o, g, view, opacity, draw, pulse }: { o: SceneObject; g: Geom; view: View; opacity: number; draw: number; pulse: number }): JSX.Element | null {
  if (opacity <= 0.001 || g.k === "axes") return null;
  const color = colorOf(o);
  const width = 2 * (1 + pulse);
  const reveal = draw < 1 ? { pathLength: 1, strokeDasharray: "1 1", strokeDashoffset: 1 - draw } : {};
  const label = o.type === "point" || o.type === "vector" ? o.label : undefined;
  let shape: JSX.Element;
  if (g.k === "pts") {
    const filled = o.type === "polygon";
    shape = <path d={pathOf(g.pts, g.closed, view.height)} className={`${STROKE[color]} ${filled ? FILL[color] : "fill-none"}`} fillOpacity={filled ? 0.15 : 0} strokeWidth={width} strokeLinejoin="round" strokeLinecap="round" {...reveal} />;
  } else if (g.k === "dot") shape = <circle cx={g.at[0]} cy={g.at[1]} r={4 * (1 + pulse)} className={FILL[color]} />;
  else if (g.k === "ell") shape = <ellipse cx={g.c[0]} cy={g.c[1]} rx={Math.abs(g.rx)} ry={Math.abs(g.ry)} className={`${STROKE[color]} fill-none`} strokeWidth={width} {...reveal} />;
  else if (g.k === "arrow") {
    const [x1, y1] = g.from;
    const [x2, y2] = g.to;
    const a = Math.atan2(y2 - y1, x2 - x1);
    const h = 9 * (1 + pulse);
    const head = `${x2},${y2} ${x2 - h * Math.cos(a - 0.4)},${y2 - h * Math.sin(a - 0.4)} ${x2 - h * Math.cos(a + 0.4)},${y2 - h * Math.sin(a + 0.4)}`;
    shape = (
      <g>
        <line x1={x1} y1={y1} x2={x2} y2={y2} className={STROKE[color]} strokeWidth={width} {...reveal} />
        <polygon points={head} className={FILL[color]} />
      </g>
    );
  } else shape = o.type === "label" ? <TexLabel tex={o.text} at={[g.at[0] - 6, g.at[1] + 10]} className={TEXT[color]} /> : <g />;
  const tip = g.k === "dot" ? g.at : g.k === "arrow" ? g.to : null;
  return (
    <g opacity={opacity}>
      {shape}
      {label && tip && <TexLabel tex={label} at={tip} className={TEXT[color]} />}
    </g>
  );
}
