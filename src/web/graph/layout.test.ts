import { expect, test } from "bun:test";
import { layoutGraph, layoutKey, listHubDomains, type LayoutEdge, type LayoutNode } from "./layout.ts";

// O(n)
function graph(n: number): { nodes: LayoutNode[]; edges: LayoutEdge[] } {
  const nodes = Array.from({ length: n }, (_, i) => ({ id: `n${i}`, domain: `d${i % 8}`, attempts: i % 7 }));
  const edges = Array.from({ length: Math.floor(n * 1.5) }, (_, i) => ({ src: `n${i % n}`, dst: `n${(i * 7 + 3) % n}` }));
  return { nodes, edges };
}

test("layoutGraph is deterministic and returns one point per node then hub", () => {
  const g = graph(24);
  const a = layoutGraph(g.nodes, g.edges);
  const b = layoutGraph(g.nodes, g.edges);
  expect(a).toEqual(b);
  expect(a.length).toBe(g.nodes.length + listHubDomains(g.nodes).length);
  expect(a.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
});

test("layoutKey hashes ids, domains, attempts and edges in order", () => {
  const g = graph(6);
  const same = layoutKey(g.nodes, g.edges);
  expect(layoutKey(g.nodes, g.edges)).toBe(same);
  const extraField = g.nodes.map((n, i) => (i === 0 ? { ...n, mastery: 0.9 } : n));
  expect(layoutKey(extraField, g.edges)).toBe(same);
  const attempts = g.nodes.map((n, i) => (i === 0 ? { ...n, attempts: n.attempts + 1 } : n));
  expect(layoutKey(attempts, g.edges)).not.toBe(same);
  const domain = g.nodes.map((n, i) => (i === 0 ? { ...n, domain: "other" } : n));
  expect(layoutKey(domain, g.edges)).not.toBe(same);
  const extra = [...g.edges, { src: "n0", dst: "n1" }];
  expect(layoutKey(g.nodes, extra)).not.toBe(same);
  const reordered = { nodes: [g.nodes[1]!, g.nodes[0]!, ...g.nodes.slice(2)], edges: g.edges };
  expect(layoutKey(reordered.nodes, reordered.edges)).not.toBe(same);
});
