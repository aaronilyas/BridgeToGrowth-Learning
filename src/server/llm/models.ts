import { env } from "../env.ts";

export type Tier = "free";
export type ModelInfo = { id: string; label: string; tier: Tier; vision: boolean };
export type Price = { promptPerTok: number; completionPerTok: number; ctx: number };
export type SystemModelKey = "grade" | "extract" | "insight";

export const FREE_PRICE: Price = { promptPerTok: 0, completionPerTok: 0, ctx: 200_000 };

export const MODELS: readonly ModelInfo[] = [
  { id: "deepseek/deepseek-v4.1-flash", label: "DeepSeek V4.1 Flash", tier: "free", vision: true },
  { id: "z-ai/glm-5.3-flash", label: "GLM-5.3-Flash", tier: "free", vision: true },
  { id: "openai/gpt-6-luna", label: "GPT-6-Luna", tier: "free", vision: true },
];

export const SYSTEM_MODELS: { grade: string; extract: string; insight: string } = {
  grade: env.OPENROUTER_MODEL,
  extract: env.OPENROUTER_MODEL,
  insight: env.OPENROUTER_MODEL,
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
