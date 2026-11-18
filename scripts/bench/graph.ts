// Graph layout bench. Run: bun scripts/bench/graph.ts
import { layoutGraph, type LayoutEdge, type LayoutNode } from "../../src/web/graph/layout.ts";

// O(n)
function graph(n: number): { nodes: LayoutNode[]; edges: LayoutEdge[] } {
  const nodes = Array.from({ length: n }, (_, i) => ({ id: `n${i}`, domain: `d${i % 8}`, attempts: i % 7 }));
  const edges = Array.from({ length: Math.floor(n * 1.5) }, (_, i) => ({ src: `n${i % n}`, dst: `n${(i * 7 + 3) % n}` }));
  return { nodes, edges };
}

layoutGraph(graph(20).nodes, graph(20).edges);
for (const n of [50, 200, 500]) {
  const g = graph(n);
  const times: number[] = [];
  for (let k = 0; k < 3; k++) {
    const t0 = performance.now();
    layoutGraph(g.nodes, g.edges);
    times.push(performance.now() - t0);
  }
  console.log(`layoutGraph ${n} nodes: median ${times.sort((a, b) => a - b)[1]!.toFixed(0)} ms (main-thread block)`);
}
