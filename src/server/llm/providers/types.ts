export type ProviderId = "openrouter" | "codex" | "spacexai";
export type AuthKind = "api_key" | "subscription";
export type ReasoningLevel = "low" | "high" | "max";
export type ImagePart = { mime: string; dataUrl: string };
export type ModelRef = {
  provider: ProviderId;
  id: string;
  label: string;
  vision: boolean;
  structured: "native" | "prompted";
  reasoning: readonly ReasoningLevel[];
  contextTokens: number;
};
export type ChatMessage = { role: "user" | "assistant"; text: string; images?: readonly ImagePart[] };
export type LlmRequest = {
  model: ModelRef;
  system: string;
  messages: readonly ChatMessage[];
  reasoning: ReasoningLevel;
  maxOutputTokens: number;
  signal: AbortSignal;
  jsonSchema?: Record<string, unknown>;
};
export type LlmErrorCode = "not_connected" | "auth_expired" | "rate_limited" | "quota_exhausted" | "model_unavailable" | "bad_output" | "timeout" | "provider_error";
export type LlmEvent =
  | { type: "text"; delta: string }
  | { type: "usage"; inputTokens: number; outputTokens: number; costUsd: number | null }
  | { type: "done" }
  | { type: "error"; code: LlmErrorCode };
export type ConnectionStatus = {
  provider: ProviderId;
  auth: AuthKind;
  connected: boolean;
  detail: "ok" | "cli_missing" | "logged_out" | "key_invalid" | "unreachable";
};
export type ProviderAdapter = {
  id: ProviderId;
  auth: AuthKind;
  status: () => Promise<ConnectionStatus>;
  listModels: () => Promise<readonly ModelRef[]>;
  stream: (req: LlmRequest) => AsyncIterable<LlmEvent>;
};
