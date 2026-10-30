import type { JSX } from "react";
import { Panel } from "./Panel.tsx";

// O(1)
export function Placeholder({ title, note }: { title: string; note: string }): JSX.Element {
  return (
    <Panel className="min-h-full">
      <h1 className="text-3xl font-semibold">{title}</h1>
      <p className="mt-2 text-muted">{note}</p>
    </Panel>
  );
}
