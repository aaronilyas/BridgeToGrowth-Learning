import type { JSX } from "react";

// O(1)
export function Spinner({ size = 20, label }: { size?: number; label?: string }): JSX.Element {
  return (
    <span role="status" className="inline-flex items-center gap-2 text-muted">
      <span className="inline-block animate-spin rounded-full border-2 border-current border-t-transparent" style={{ width: size, height: size }} />
      {label ? <span className="text-sm">{label}</span> : <span className="sr-only">Loading</span>}
    </span>
  );
}
