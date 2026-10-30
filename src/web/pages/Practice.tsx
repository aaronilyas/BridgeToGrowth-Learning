import type { JSX } from "react";
import { Placeholder } from "../components/Placeholder.tsx";

// O(1)
export function PracticePage(): JSX.Element {
  return <Placeholder title="Practice" note="Spaced practice arrives in P12." />;
}
