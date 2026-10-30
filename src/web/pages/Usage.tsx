import type { JSX } from "react";
import { Placeholder } from "../components/Placeholder.tsx";

// O(1)
export function UsagePage(): JSX.Element {
  return <Placeholder title="Usage" note="Usage details arrive in P14." />;
}
