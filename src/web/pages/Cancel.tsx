import type { JSX } from "react";
import { Placeholder } from "../components/Placeholder.tsx";

// O(1)
export function CancelPage(): JSX.Element {
  return <Placeholder title="Cancel subscription" note="The cancel flow arrives in P14." />;
}
