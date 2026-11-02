export type Tier = "free";
export type ModelInfo = { id: string; label: string; tier: Tier; vision: boolean };

export const MODELS: readonly ModelInfo[] = [
  { id: "deepseek/deepseek-v4.1-flash", label: "DeepSeek V4.1 Flash", tier: "free", vision: true },
  { id: "z-ai/glm-5.3-flash", label: "GLM-5.3-Flash", tier: "free", vision: true },
  { id: "openai/gpt-6-luna", label: "GPT-6-Luna", tier: "free", vision: true },
];
