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

// O(1)
export function curatedOpenRouterModels(): readonly ModelRef[] {
  return OPENROUTER_FALLBACK;
}

// O(1)
export function curatedSpaceXaiModels(): readonly ModelRef[] {
  return SPACEXAI_FALLBACK;
}
