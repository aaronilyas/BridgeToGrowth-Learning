import type { JSX } from "react";
import { Slider } from "./Slider.tsx";

// O(1)
export function ConfidenceSlider({ value, onChange }: { value: number; onChange: (v: number) => void }): JSX.Element {
  return <Slider label="Confidence" value={value} onChange={onChange} lowLabel="Low" highLabel="High" />;
}
