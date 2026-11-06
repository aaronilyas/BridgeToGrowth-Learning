import type { JSX } from "react";
import type { ConnectionStatus } from "../../../shared/providers.ts";
import { ClaudeCard } from "./ClaudeCard.tsx";
import { CodexCard } from "./CodexCard.tsx";
import { KeyCard } from "./KeyCard.tsx";
import { SpaceXaiCard } from "./SpaceXaiCard.tsx";

// O(1)
export function ProviderCard({ status, onChanged }: { status: ConnectionStatus; onChanged: () => Promise<void> }): JSX.Element {
  if (status.provider === "codex") return <CodexCard status={status} onChanged={onChanged} />;
  if (status.provider === "claude") return <ClaudeCard status={status} onChanged={onChanged} />;
  if (status.provider === "spacexai") return <SpaceXaiCard status={status} onChanged={onChanged} />;
  return <KeyCard status={status} onChanged={onChanged} />;
}
