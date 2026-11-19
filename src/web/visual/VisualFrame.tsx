import type { JSX } from "react";
import type { VisualKind } from "../../shared/visual.ts";

const NOUN: Record<VisualKind, string> = { plot: "plot", scene: "animation", diagram: "diagram" };

// O(1)
export function VisualPending({ kind }: { kind: VisualKind }): JSX.Element {
  return (
    <div className="visual my-4 rounded-lg border border-dashed border-border px-4 py-6 text-center font-mono text-xs text-muted" role="status">
      <span className="animate-pulse motion-reduce:animate-none">Drawing the {NOUN[kind]}…</span>
    </div>
  );
}

// O(n) in source length
// SEC: the source shows as an escaped React text node
export function VisualError({ kind, message, source }: { kind: VisualKind; message: string; source: string }): JSX.Element {
  return (
    <div className="visual my-4 rounded-lg border border-border px-3 py-2 text-sm">
      <p className="m-0 text-muted">
        <span className="text-danger">The {NOUN[kind]} could not be drawn:</span> {message}
      </p>
      <details className="mt-1">
        <summary className="cursor-pointer font-mono text-xs text-muted">Source</summary>
        <pre className="mt-2 max-h-72 overflow-auto text-xs"><code>{source}</code></pre>
      </details>
    </div>
  );
}
