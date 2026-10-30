import { useId, type JSX } from "react";

// O(1)
export function Slider({ label, value, onChange, min = 0, max = 100, step = 1, format = (v) => `${v}%`, lowLabel, highLabel }: { label: string; value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; format?: (v: number) => string; lowLabel?: string; highLabel?: string }): JSX.Element {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-4">
        <label htmlFor={id} className="w-28 shrink-0 text-sm font-medium text-text">{label}</label>
        <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.currentTarget.value))} className="h-1.5 w-full cursor-pointer" />
        <output htmlFor={id} className="w-12 shrink-0 text-right text-sm font-semibold text-accent">{format(value)}</output>
      </div>
      {(lowLabel || highLabel) && (
        <div className="ml-32 mr-16 flex justify-between text-xs text-muted">
          <span>{lowLabel}</span>
          <span>{highLabel}</span>
        </div>
      )}
    </div>
  );
}
