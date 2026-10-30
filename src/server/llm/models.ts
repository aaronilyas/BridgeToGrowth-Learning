export type Tier = "trial" | "pro";
export type ModelInfo = { id: string; label: string; tier: Tier; vision: boolean };
export type Price = { promptPerTok: number; completionPerTok: number; ctx: number };
export type SystemModelKey = "grade" | "extract" | "insight";

export const MODELS: readonly ModelInfo[] = [
  { id: "anthropic/claude-haiku-5.5", label: "Claude Haiku 5.5", tier: "trial", vision: true },
  { id: "openai/gpt-6-luna", label: "GPT-6 Luna", tier: "trial", vision: true },
  { id: "anthropic/claude-opus-5.5", label: "Claude Opus 5.5", tier: "pro", vision: true },
  { id: "openai/gpt-6.1-sol", label: "GPT-6.1 Sol", tier: "pro", vision: true },
  { id: "google/gemini-4-argon", label: "Gemini 4 Argon", tier: "pro", vision: true },
  { id: "x-ai/grok-4.7", label: "Grok 4.7", tier: "pro", vision: true },
];

export const SYSTEM_MODELS: { grade: string; extract: string; insight: string } = {
  grade: "openai/gpt-6-luna",
  extract: "anthropic/claude-haiku-5.5",
  insight: "openai/gpt-6-luna",
};

let pricing: Map<string, Price> | null = null;

// O(1)
// INV: null until the first successful /models fetch; ids absent from a loaded map were dropped upstream
export function setPricing(next: Map<string, Price> | null): void {
  pricing = next;
}

// O(1)
export function priceOf(id: string): { loaded: boolean; price: Price | undefined } {
  return { loaded: pricing !== null, price: pricing?.get(id) };
}

// O(1)
// INV: before pricing loads every allowlisted id counts as listed, so the allowlist survives offline boots
export function isModelListed(id: string): boolean {
  return pricing === null || pricing.has(id);
}
