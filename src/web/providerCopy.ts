import type { ProviderId } from "../shared/providers.ts";

const TITLES: Record<ProviderId, string> = {
  openrouter: "OpenRouter",
  codex: "Codex",
  spacexai: "SpaceXAI",
  claude: "Claude",
};

// O(1)
export function titleOfProvider(id: ProviderId): string {
  return TITLES[id];
}

const KEY_NOTES: Record<ProviderId, string> = {
  openrouter: "Create a key on OpenRouter's keys page, then paste it here. It is stored only in your system keychain.",
  codex: "",
  spacexai: "Create an API key in the xAI console, then paste it here. The key is stored only in your system keychain.",
  claude: "",
};

// O(1)
export function keyNoteOf(id: ProviderId): string {
  return KEY_NOTES[id];
}
