import type { JSX, ReactNode } from "react";

// O(1)
export function Panel({ children, className = "", as: Tag = "section", soft = false }: { children: ReactNode; className?: string; as?: "section" | "div" | "aside" | "article"; soft?: boolean }): JSX.Element {
  return <Tag className={`rounded-2xl border border-border ${soft ? "bg-panel-2" : "bg-panel"} p-5 ${className}`}>{children}</Tag>;
}
