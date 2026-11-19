import type { JSX } from "react";
import { checkPlot } from "../../shared/visual.ts";
import { runFigure } from "../pyodide/runner.ts";
import { createVisualCache, oneLine, svgDataUri, useVisualResult } from "./cache.ts";
import { VisualError, VisualPending } from "./VisualFrame.tsx";

export type PlotResult = { ok: true; uri: string } | { ok: false; error: string };

const plots = createVisualCache<PlotResult>();

// O(code + figure size) plus one Pyodide run
// INV: resolves, never rejects; Python runs only in the worker, under its time and memory limits
async function drawPlot(source: string): Promise<PlotResult> {
  const bad = checkPlot(source);
  if (bad !== null) return { ok: false, error: bad };
  try {
    const r = await runFigure(source);
    return r.svg !== null ? { ok: true, uri: svgDataUri(r.svg) } : { ok: false, error: oneLine(r.error ?? "The code drew no figure.") };
  } catch {
    return { ok: false, error: "Python failed to start." };
  }
}

// O(1) per render
// SEC: the figure is shown as <img src="data:image/svg+xml…">, so nothing in it can run
export function PlotView({ source }: { source: string }): JSX.Element {
  const r = useVisualResult(plots, source, drawPlot);
  if (r === undefined) return <VisualPending kind="plot" />;
  if (!r.ok) return <VisualError kind="plot" message={r.error} source={source} />;
  return (
    <figure className="visual my-4">
      <img src={r.uri} alt="Plot drawn for this lesson" className="mx-auto block h-auto max-w-full rounded-lg bg-white p-2" />
    </figure>
  );
}
