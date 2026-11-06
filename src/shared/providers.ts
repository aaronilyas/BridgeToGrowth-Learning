import { z } from "zod";

export const ProviderId = z.enum(["openrouter", "codex", "spacexai", "claude"]);
export type ProviderId = z.infer<typeof ProviderId>;

export const ReasoningLevel = z.enum(["low", "high", "max"]);
export type ReasoningLevel = z.infer<typeof ReasoningLevel>;

export const SubscriptionDetail = z.enum(["ok", "cli_missing", "logged_out"]);
export type SubscriptionDetail = z.infer<typeof SubscriptionDetail>;

export const ConnectionStatus = z.strictObject({
  provider: ProviderId,
  auth: z.enum(["api_key", "subscription"]),
  connected: z.boolean(),
  detail: z.enum(["ok", "cli_missing", "logged_out", "key_invalid", "unreachable"]),
  last4: z.string().length(4).optional(),
  subscription: SubscriptionDetail.optional(),
});
export type ConnectionStatus = z.infer<typeof ConnectionStatus>;

export const ModelRef = z.strictObject({
  provider: ProviderId,
  id: z.string().min(1).max(200),
  label: z.string().min(1).max(200),
  vision: z.boolean(),
  structured: z.enum(["native", "prompted"]),
  reasoning: z.array(ReasoningLevel),
  contextTokens: z.number().int().nonnegative(),
});
export type ModelRef = z.infer<typeof ModelRef>;

export const ProviderKeyBody = z.strictObject({ key: z.string().min(1).max(4000) });
export type ProviderKeyBody = z.infer<typeof ProviderKeyBody>;

export const LoginMethod = z.enum(["device", "browser"]);
export type LoginMethod = z.infer<typeof LoginMethod>;

export const LoginBody = z.strictObject({ method: LoginMethod });
export type LoginBody = z.infer<typeof LoginBody>;

export const LoginState = z.strictObject({
  state: z.enum(["idle", "pending", "ok", "failed"]),
  method: LoginMethod,
  url: z.string().regex(/^https:\/\/(?:auth\.openai\.com|accounts\.x\.ai|auth\.x\.ai)\//).max(4000).optional(),
  code: z.string().regex(/^[A-Z0-9]{4}-[A-Z0-9]{4,6}$/).optional(),
});
export type LoginState = z.infer<typeof LoginState>;

export const ExternalTarget = z.enum(["openrouter_keys", "spacexai_keys", "codex_signin", "codex_install", "spacexai_signin", "grok_install", "claude_install"]);
export type ExternalTarget = z.infer<typeof ExternalTarget>;

export const OpenExternalBody = z.strictObject({ target: ExternalTarget });
export type OpenExternalBody = z.infer<typeof OpenExternalBody>;

const UsageModel = z.strictObject({
  provider: ProviderId,
  model: z.string(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  costUsd: z.number().nonnegative().nullable(),
});
export type UsageModel = z.infer<typeof UsageModel>;

const UsageMonth = z.strictObject({
  period: z.string().regex(/^\d{4}-\d{2}$/),
  models: z.array(UsageModel),
});

export const UsageResponse = z.strictObject({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  current: z.array(UsageModel),
  recent: z.array(UsageMonth),
});
export type UsageResponse = z.infer<typeof UsageResponse>;
