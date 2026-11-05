import type { JSX } from "react";
import { setZoom, stepZoom, useZoom, ZOOM_LEVELS } from "../zoom.ts";

const btn = "rounded-md px-1.5 leading-none text-muted transition hover:bg-panel-2 hover:text-text disabled:opacity-40 disabled:hover:bg-transparent focus-visible:outline-2 focus-visible:outline-accent";

// O(1)
// INV: the percentage is relative to the app's default size; clicking it resets to 100%
export function ZoomControl({ vertical = false }: { vertical?: boolean }): JSX.Element {
  const zoom = useZoom();
  const pct = Math.round(zoom * 100);
  return (
    <div role="group" aria-label="Zoom" className={`flex items-center gap-0.5 font-mono text-[0.7rem] text-muted ${vertical ? "flex-col" : ""}`}>
      <button type="button" className={btn} onClick={() => setZoom(stepZoom(zoom, -1))} disabled={zoom === ZOOM_LEVELS[0]} aria-label="Zoom out" title="Zoom out (Ctrl −)">
        −
      </button>
      <button type="button" className={`${btn} min-w-[3.2em] py-0.5`} onClick={() => setZoom(1)} aria-label={`Zoom ${pct}%, reset`} title="Reset zoom (Ctrl 0)">
        {pct}%
      </button>
      <button type="button" className={btn} onClick={() => setZoom(stepZoom(zoom, 1))} disabled={zoom === ZOOM_LEVELS[ZOOM_LEVELS.length - 1]} aria-label="Zoom in" title="Zoom in (Ctrl +)">
        +
      </button>
    </div>
  );
}
