import { MODELS } from "../models.ts";
import type { ModelRef } from "./types.ts";

const REASONING = ["low", "high", "max"] as const;

const OPENROUTER_FALLBACK: readonly ModelRef[] = MODELS.map((model) => ({
  provider: "openrouter",
  id: model.id,
  label: model.label,
  vision: model.vision,
  structured: "native",
  reasoning: REASONING,
  contextTokens: 128_000,
}));

const SPACEXAI_FALLBACK: readonly ModelRef[] = [
  { provider: "spacexai", id: "grok-4.7", label: "Grok 4.7", vision: true, structured: "native", reasoning: REASONING, contextTokens: 500_000 },
  { provider: "spacexai", id: "grok-4.3", label: "Grok 4.3", vision: true, structured: "native", reasoning: REASONING, contextTokens: 500_000 },
  { provider: "spacexai", id: "grok-4", label: "Grok 4", vision: true, structured: "native", reasoning: REASONING, contextTokens: 256_000 },
];

// INV: aliases the Claude Code CLI resolves to the newest model of each family; used only if the account's own list cannot be read
const CLAUDE_FALLBACK: readonly ModelRef[] = [
  { provider: "claude", id: "opus", label: "Claude Opus (latest)", vision: true, structured: "native", reasoning: REASONING, contextTokens: 0 },
  { provider: "claude", id: "sonnet", label: "Claude Sonnet (latest)", vision: true, structured: "native", reasoning: REASONING, contextTokens: 0 },
  { provider: "claude", id: "haiku", label: "Claude Haiku (latest)", vision: true, structured: "native", reasoning: REASONING, contextTokens: 0 },
];

// O(1)
export function curatedOpenRouterModels(): readonly ModelRef[] {
  return OPENROUTER_FALLBACK;
}

// O(1)
export function curatedSpaceXaiModels(): readonly ModelRef[] {
  return SPACEXAI_FALLBACK;
}

// O(1)
export function curatedClaudeModels(): readonly ModelRef[] {
  return CLAUDE_FALLBACK;
}
