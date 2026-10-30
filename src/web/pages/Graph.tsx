import { useEffect, useMemo, useRef, useState, type JSX } from "react";
import { GraphResponse } from "../../shared/api.ts";
import { api } from "../api.ts";
import { AskBar } from "../components/AskBar.tsx";
import { ErrorBanner } from "../components/ErrorBanner.tsx";
import { Panel } from "../components/Panel.tsx";
import { Spinner } from "../components/Spinner.tsx";
import { GraphView } from "../graph/GraphView.tsx";
import { NodePanel } from "../graph/NodePanel.tsx";

function Overview({ graph }: { graph: GraphResponse }): JSX.Element {
  const domains = new Set(graph.nodes.map((n) => n.domain)).size;
  const mean = graph.nodes.length === 0 ? null : graph.nodes.reduce((a, n) => a + n.mastery, 0) / graph.nodes.length;
  const rows: [string, string][] = [
    ["Concepts", String(graph.nodes.length)],
    ["Connections", String(graph.edges.length)],
    ["Domains", String(domains)],
    ["Avg. mastery", mean === null ? "—" : `${Math.round(mean * 100)}%`],
  ];
  return (
    <Panel as="aside" className="flex w-52 shrink-0 flex-col gap-1 self-start">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Overview</h2>
      {rows.map(([k, v]) => (
        <div key={k} className="border-t border-border py-3 first:border-t-0">
          <p className="text-sm text-muted">{k}</p>
          <p className="text-3xl font-semibold">{v}</p>
        </div>
      ))}
      {mean !== null && (
        <div className="h-2 overflow-hidden rounded-full bg-border" role="progressbar" aria-label="Average mastery" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(mean * 100)}>
          <div className="h-full rounded-full bg-accent" style={{ width: `${Math.round(mean * 100)}%` }} />
        </div>
      )}
    </Panel>
  );
}

// O(V + E)
export function GraphPage(): JSX.Element {
  const [graph, setGraph] = useState<GraphResponse | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const search = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let live = true;
    api("/api/graph", GraphResponse).then((g) => live && setGraph(g), (e: unknown) => live && setError(e));
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    const key = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        search.current?.focus();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);

  const selected = useMemo(() => graph?.nodes.find((n) => n.id === selectedId) ?? null, [graph, selectedId]);

  if (!graph) return error ? <ErrorBanner error={error} /> : <Spinner label="Loading graph" />;
  if (graph.nodes.length === 0) {
    return (
      <Panel className="mx-auto mt-16 flex max-w-3xl flex-col gap-4">
        <h1 className="text-3xl font-semibold">Learn your first topic</h1>
        <p className="text-muted">Your knowledge graph grows with every lesson. Ask for a topic to plant the first node.</p>
        <AskBar />
      </Panel>
    );
  }
  return (
    <div className="flex h-[calc(100vh-1.5rem)] flex-col gap-3">
      <div className="flex items-center gap-3">
        <input
          ref={search}
          type="search"
          className="w-full max-w-md rounded-xl border border-border bg-panel px-4 py-2.5 text-sm outline-none focus:border-accent"
          placeholder="Search knowledge graph…  (Ctrl K)"
          aria-label="Search knowledge graph"
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
        />
        <p className="text-xs text-muted">Drag to pan · scroll to zoom · click a node</p>
      </div>
      <div className="flex min-h-0 flex-1 gap-3">
        <Overview graph={graph} />
        <div className="relative min-w-0 flex-1 overflow-hidden rounded-2xl border border-border bg-panel">
          <GraphView graph={graph} query={query} selectedId={selectedId} onSelect={setSelectedId} />
          {selected && <NodePanel key={selected.id} node={selected} onClose={() => setSelectedId(null)} />}
        </div>
      </div>
      <AskBar />
    </div>
  );
}
