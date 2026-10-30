import { memo, useEffect, useMemo, useRef, type JSX, type PointerEvent as ReactPointerEvent } from "react";
import { Domain, type GraphResponse } from "../../shared/api.ts";
import { layoutGraph, listHubDomains, radiusOf, type Point } from "./layout.ts";

export type GNode = GraphResponse["nodes"][number];
type VB = { x: number; y: number; w: number; h: number };

const GLYPHS: Record<Domain, string> = {
  math: "M18 6H7l6 6-6 6h11",
  physics: "M12 12m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0M4 12c0-3 4-5 8-5s8 2 8 5-4 5-8 5-8-2-8-5zM8 4c3-1 7 3 8 8s-1 7-4 8",
  chemistry: "M9 3h6M10 3v6l-5 9a1.5 1.5 0 0 0 1.3 2h11.4a1.5 1.5 0 0 0 1.3-2l-5-9V3M7.5 15h9",
  biology: "M5 19C5 10 10 5 19 5c0 9-5 14-14 14zM5 19l8-8",
  cs: "M8 8l-4 4 4 4M16 8l4 4-4 4M13.5 6l-3 12",
  engineering: "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1",
  statistics: "M5 20V12M12 20V5M19 20v-9M3 20h18",
  earth: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18",
  other: "M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.5 6.6 19.5l1.2-6L3.3 9.3l6.1-.7z",
};

// O(1)
export function hueOf(domain: string): string {
  const d = Domain.safeParse(domain);
  return `var(--d-${d.success ? d.data : "other"})`;
}

function glyphOf(domain: string): string {
  const d = Domain.safeParse(domain);
  return GLYPHS[d.success ? d.data : "other"];
}

type LayerProps = { nodes: GNode[]; edges: GraphResponse["edges"]; pos: Point[]; hubs: string[]; matches: Set<string> | null; selectedId: string | null; onSelect: (id: string) => void; moved: { current: boolean } };

const Layer = memo(function Layer({ nodes, edges, pos, hubs, matches, selectedId, onSelect, moved }: LayerProps): JSX.Element {
  const index = useMemo(() => new Map(nodes.map((n, i) => [n.id, i])), [nodes]);
  const hubIdx = (d: string): number => nodes.length + hubs.indexOf(d);
  return (
    <g>
      {nodes.map((n, i) => {
        const h = pos[hubIdx(n.domain)];
        const p = pos[i];
        if (!h || !p) return null;
        return <line key={`h${n.id}`} x1={h.x} y1={h.y} x2={p.x} y2={p.y} stroke={hueOf(n.domain)} strokeOpacity={matches && !matches.has(n.id) ? 0.08 : 0.4} strokeWidth={1.2} />;
      })}
      {edges.map((e) => {
        const a = index.get(e.dst);
        const b = index.get(e.src);
        const pa = a === undefined ? undefined : pos[a];
        const pb = b === undefined ? undefined : pos[b];
        const nb = b === undefined ? undefined : nodes[b];
        const na = a === undefined ? undefined : nodes[a];
        if (!pa || !pb || !na || !nb) return null;
        const dim = matches !== null && !matches.has(na.id) && !matches.has(nb.id);
        const dx = pb.x - pa.x;
        const dy = pb.y - pa.y;
        const len = Math.hypot(dx, dy) || 1;
        const r = radiusOf(nb.attempts) + 3;
        const ex = e.kind === "prereq" ? pb.x - (dx / len) * r : pb.x;
        const ey = e.kind === "prereq" ? pb.y - (dy / len) * r : pb.y;
        return <line key={`${e.src}${e.dst}${e.kind}`} x1={pa.x} y1={pa.y} x2={ex} y2={ey} stroke="var(--muted)" strokeWidth={1.4} strokeOpacity={dim ? 0.1 : 0.75} strokeDasharray={e.kind === "related" ? "5 4" : undefined} markerEnd={e.kind === "prereq" ? "url(#arrow)" : undefined} />;
      })}
      {hubs.map((d, i) => {
        const p = pos[nodes.length + i];
        if (!p) return null;
        return (
          <g key={d} transform={`translate(${p.x} ${p.y})`} style={{ color: hueOf(d) }} opacity={matches && !nodes.some((n) => n.domain === d && matches.has(n.id)) ? 0.25 : 1}>
            <circle r={26} fill="var(--panel)" stroke="currentColor" strokeWidth={2} />
            <circle r={26} fill="currentColor" fillOpacity={0.14} />
            <path d={glyphOf(d)} transform="translate(-11 -11) scale(0.92)" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
            <text y={44} textAnchor="middle" fontSize={13} fontWeight={600} fill="var(--text)">{d}</text>
          </g>
        );
      })}
      {nodes.map((n, i) => {
        const p = pos[i];
        if (!p) return null;
        const r = radiusOf(n.attempts);
        const dim = matches !== null && !matches.has(n.id);
        const selected = n.id === selectedId;
        return (
          <g key={n.id} transform={`translate(${p.x} ${p.y})`} opacity={dim ? 0.18 : 1} className="cursor-pointer" role="button" tabIndex={0} aria-label={`${n.name}, mastery ${Math.round(n.mastery * 100)}%`} onClick={() => !moved.current && onSelect(n.id)} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onSelect(n.id)}>
            {selected && <circle r={r + 6} fill="none" stroke="var(--accent)" strokeWidth={2.5} />}
            <circle r={r} fill={hueOf(n.domain)} fillOpacity={0.35 + 0.65 * Math.min(1, Math.max(0, n.mastery))} stroke={hueOf(n.domain)} strokeWidth={1.5} />
            <text y={r + 13} textAnchor="middle" fontSize={11} fill="var(--text)" paintOrder="stroke" stroke="var(--bg)" strokeWidth={3} strokeLinejoin="round">{n.name}</text>
          </g>
        );
      })}
    </g>
  );
});

// O(V + E) per render of the static layer; pan and zoom touch only the viewBox attribute
// INV: positions are computed once per data hash; no React state changes while panning
export function GraphView({ graph, query, selectedId, onSelect }: { graph: GraphResponse; query: string; selectedId: string | null; onSelect: (id: string) => void }): JSX.Element {
  const key = useMemo(() => JSON.stringify([graph.nodes.map((n) => [n.id, n.domain, n.attempts]), graph.edges.map((e) => [e.src, e.dst])]), [graph]);
  const hubs = useMemo(() => listHubDomains(graph.nodes), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const pos = useMemo(() => layoutGraph(graph.nodes, graph.edges), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const q = query.trim().toLowerCase();
  const matches = useMemo(() => (q === "" ? null : new Set(graph.nodes.filter((n) => n.name.toLowerCase().includes(q) || n.domain.includes(q)).map((n) => n.id))), [graph.nodes, q]);
  const svg = useRef<SVGSVGElement>(null);
  const vb = useRef<VB>({ x: -300, y: -200, w: 600, h: 400 });
  const moved = useRef(false);
  const drag = useRef<{ x: number; y: number; sx: number; sy: number } | null>(null);

  const apply = (): void => svg.current?.setAttribute("viewBox", `${vb.current.x} ${vb.current.y} ${vb.current.w} ${vb.current.h}`);

  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const fit = (): void => {
      const r = el.getBoundingClientRect();
      if (r.width === 0) return;
      let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
      for (const p of pos) [x0, y0, x1, y1] = [Math.min(x0, p.x), Math.min(y0, p.y), Math.max(x1, p.x), Math.max(y1, p.y)];
      if (!Number.isFinite(x0)) [x0, y0, x1, y1] = [-100, -100, 100, 100];
      const pad = 90;
      const w = Math.max(x1 - x0 + 2 * pad, 200);
      const h = Math.max(y1 - y0 + 2 * pad, 200);
      const s = Math.max(w / r.width, h / r.height);
      vb.current = { x: (x0 + x1) / 2 - (r.width * s) / 2, y: (y0 + y1) / 2 - (r.height * s) / 2, w: r.width * s, h: r.height * s };
      apply();
    };
    fit();
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      if (r.width === 0) return;
      vb.current = { ...vb.current, h: (vb.current.w * r.height) / r.width };
      apply();
    });
    ro.observe(el);
    const wheel = (e: WheelEvent): void => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const f = Math.exp(e.deltaY * 0.0015);
      const cur = vb.current;
      const w = Math.min(8000, Math.max(80, cur.w * f));
      const k = w / cur.w;
      const mx = cur.x + ((e.clientX - r.left) / r.width) * cur.w;
      const my = cur.y + ((e.clientY - r.top) / r.height) * cur.h;
      vb.current = { x: mx - (mx - cur.x) * k, y: my - (my - cur.y) * k, w, h: cur.h * k };
      apply();
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => {
      ro.disconnect();
      el.removeEventListener("wheel", wheel);
    };
  }, [pos]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const move = (e: PointerEvent): void => {
      const d = drag.current;
      const el = svg.current;
      if (!d || !el) return;
      const r = el.getBoundingClientRect();
      if (Math.abs(e.clientX - d.sx) + Math.abs(e.clientY - d.sy) > 4) moved.current = true;
      vb.current = { ...vb.current, x: d.x - ((e.clientX - d.sx) / r.width) * vb.current.w, y: d.y - ((e.clientY - d.sy) / r.height) * vb.current.h };
      apply();
    };
    const up = (): void => {
      drag.current = null;
      setTimeout(() => (moved.current = false), 0);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, []);

  const down = (e: ReactPointerEvent<SVGSVGElement>): void => {
    moved.current = false;
    drag.current = { x: vb.current.x, y: vb.current.y, sx: e.clientX, sy: e.clientY };
  };

  return (
    <svg ref={svg} role="img" aria-label={`Knowledge graph with ${graph.nodes.length} topics in ${hubs.length} domains and ${graph.edges.length} connections`} className="h-full w-full cursor-grab touch-none select-none active:cursor-grabbing" viewBox="-300 -200 600 400" onPointerDown={down}>
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0 0L10 5L0 10z" fill="var(--muted)" />
        </marker>
      </defs>
      <Layer nodes={graph.nodes} edges={graph.edges} pos={pos} hubs={hubs} matches={matches} selectedId={selectedId} onSelect={onSelect} moved={moved} />
    </svg>
  );
}
