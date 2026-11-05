import type { JSX } from "react";
import { Slider } from "./Slider.tsx";

// O(1)
export function ConfidenceSlider({ value, onChange, disabled = false }: { value: number; onChange: (v: number) => void; disabled?: boolean }): JSX.Element {
  return <Slider label="Confidence" value={value} onChange={onChange} disabled={disabled} />;
}
