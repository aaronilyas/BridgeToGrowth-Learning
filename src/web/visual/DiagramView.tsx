import type { JSX } from "react";
import { createVisualCache, useVisualResult } from "./cache.ts";
import { drawDiagram, type DiagramResult } from "./diagram.ts";
import { VisualError, VisualPending } from "./VisualFrame.tsx";

const diagrams = createVisualCache<DiagramResult>();

// O(diagram size)
// INV: Mermaid is its own chunk, fetched the first time a diagram appears
async function drawWithMermaid(source: string): Promise<DiagramResult> {
  try {
    const mermaid = (await import("mermaid")).default;
    return await drawDiagram(source, mermaid);
  } catch {
    return { ok: false, error: "The diagram renderer could not load." };
  }
}

// O(1)
// SEC: the diagram is shown as <img src="data:image/svg+xml…">, so links, handlers and scripts in it never run
export function DiagramFigure({ uri }: { uri: string }): JSX.Element {
  return (
    <figure className="visual my-4">
      <img src={uri} alt="Diagram drawn for this lesson" className="mx-auto block h-auto max-w-full rounded-lg bg-white p-3" />
    </figure>
  );
}

// O(1) per render
export function DiagramView({ source }: { source: string }): JSX.Element {
  const r = useVisualResult(diagrams, source, drawWithMermaid);
  if (r === undefined) return <VisualPending kind="diagram" />;
  if (!r.ok) return <VisualError kind="diagram" message={r.error} source={source} />;
  return <DiagramFigure uri={r.uri} />;
}
