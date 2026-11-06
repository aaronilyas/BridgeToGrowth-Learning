import type { JSX, ReactNode } from "react";
import { Panel } from "../Panel.tsx";

export const fieldClass = "w-full rounded-lg border border-border bg-panel-2 px-3 py-2 text-text outline-none focus:border-accent";

// O(1)
export function SettingsSection({ title, hint, children, columns = false }: { title: string; hint?: string; children: ReactNode; columns?: boolean }): JSX.Element {
  return (
    <Panel>
      <h2 className="text-lg font-semibold">{title}</h2>
      {hint && <p className="mt-1 text-sm text-muted">{hint}</p>}
      <div className={`mt-4 grid gap-5 ${columns ? "sm:grid-cols-2" : ""}`}>{children}</div>
    </Panel>
  );
}

// O(1)
export function SettingsToggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }): JSX.Element {
  return (
    <label className="flex items-center gap-3 text-sm">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.currentTarget.checked)} className="size-4 accent-accent" />
      {label}
    </label>
  );
}

// O(1)
export function SettingsNumber({ label, value, min, max, step, onChange }: { label: string; value: number; min: number; max: number; step?: number; onChange: (value: number) => void }): JSX.Element {
  return (
    <label className="grid gap-1 text-sm">
      {label}
      <input className={fieldClass} type="number" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Math.max(min, Math.min(max, Number(event.currentTarget.value))))} />
    </label>
  );
}
