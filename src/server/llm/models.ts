export type ModelInfo = { id: string; label: string; vision: boolean };

export const MODELS: readonly ModelInfo[] = [
  { id: "deepseek/deepseek-v4.1-flash", label: "DeepSeek V4.1 Flash", vision: true },
  { id: "z-ai/glm-5.3-flash", label: "GLM-5.3-Flash", vision: true },
  { id: "openai/gpt-6-luna", label: "GPT-6-Luna", vision: true },
];
