import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type SimulationLinkDatum, type SimulationNodeDatum } from "d3-force";

export type LayoutNode = { id: string; domain: string; attempts: number };
export type LayoutEdge = { src: string; dst: string };
export type Point = { x: number; y: number };

const TICKS = 300;

// O(1)
export function radiusOf(attempts: number): number {
  return 6 + 4 * Math.sqrt(attempts);
}

// O(n log n)
export function listHubDomains(nodes: readonly LayoutNode[]): string[] {
  return [...new Set(nodes.map((n) => n.domain))].sort();
}

type Sim = SimulationNodeDatum & { r: number; hub: boolean };

// O(ticks·(V+E) log V)
// INV: pure and deterministic; result holds one point per node (same order), then one per hub in listHubDomains order
export function layoutGraph(nodes: readonly LayoutNode[], edges: readonly LayoutEdge[]): Point[] {
  const domains = listHubDomains(nodes);
  const sims: Sim[] = [...nodes.map((n) => ({ r: radiusOf(n.attempts), hub: false })), ...domains.map(() => ({ r: 30, hub: true }))];
  const index = new Map(nodes.map((n, i) => [n.id, i]));
  const hubOf = new Map(domains.map((d, i) => [d, nodes.length + i]));
  type Link = SimulationLinkDatum<Sim> & { strength: number; distance: number };
  const links: Link[] = [];
  nodes.forEach((n, i) => {
    const h = hubOf.get(n.domain);
    if (h !== undefined) links.push({ source: i, target: h, strength: 0.9, distance: 125 });
  });
  for (const e of edges) {
    const a = index.get(e.src);
    const b = index.get(e.dst);
    if (a !== undefined && b !== undefined) links.push({ source: a, target: b, strength: 0.12, distance: 130 });
  }
  const sim = forceSimulation<Sim>(sims)
    .force("charge", forceManyBody<Sim>().strength((d) => (d.hub ? -700 : -160)))
    .force("link", forceLink<Sim, Link>(links).strength((l) => l.strength).distance((l) => l.distance))
    .force("collide", forceCollide<Sim>((d) => d.r + (d.hub ? 22 : 8)))
    .force("x", forceX<Sim>(0).strength(0.03))
    .force("y", forceY<Sim>(0).strength(0.03))
    .force("center", forceCenter(0, 0))
    .stop();
  sim.tick(TICKS);
  return sims.map((s) => ({ x: s.x ?? 0, y: s.y ?? 0 }));
}
