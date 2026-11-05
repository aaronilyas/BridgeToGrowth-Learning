import { useId, type JSX } from "react";

// O(1)
export function Slider({ label, value, onChange, min = 0, max = 100, step = 1, format = (v) => `${v}%`, disabled = false }: { label: string; value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; format?: (v: number) => string; disabled?: boolean }): JSX.Element {
  const id = useId();
  return (
    <div className="flex items-center gap-4">
      <label htmlFor={id} className="label shrink-0">{label}</label>
      <input id={id} type="range" min={min} max={max} step={step} value={value} disabled={disabled} onChange={(e) => onChange(Number(e.currentTarget.value))} className="h-1 w-full cursor-pointer accent-accent focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-40" />
      <output htmlFor={id} className="w-10 shrink-0 text-right font-mono text-sm text-text">{format(value)}</output>
    </div>
  );
}
