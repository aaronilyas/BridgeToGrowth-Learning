import type { ProviderId } from "../shared/providers.ts";

const TITLES: Record<ProviderId, string> = {
  openrouter: "OpenRouter",
  codex: "Codex",
  spacexai: "SpaceXAI",
};

// O(1)
export function titleOfProvider(id: ProviderId): string {
  return TITLES[id];
}
