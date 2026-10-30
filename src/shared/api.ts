import { z } from "zod";

export type ErrorCode = "bad_request"|"unauthenticated"|"forbidden_origin"|"not_found"|"rate_limited"|"payment_required"|"quota_exceeded"|"model_not_allowed"|"email_taken"|"bad_credentials"|"turnstile_failed"|"unsupported_media"|"too_large"|"already_subscribed"|"upstream"|"llm_bad_output"|"internal";

export const HealthResponse = z.strictObject({ ok: z.literal(true) });
export type HealthResponse = z.infer<typeof HealthResponse>;

export const ErrorResponse = z.strictObject({ error: z.string() });
export type ErrorResponse = z.infer<typeof ErrorResponse>;

const Email = z.string().trim().toLowerCase().max(254).pipe(z.email());

export const SignupRequest = z.strictObject({ email: Email, password: z.string().min(12).max(256), turnstile: z.string().max(2048) });
export type SignupRequest = z.infer<typeof SignupRequest>;

export const LoginRequest = z.strictObject({ email: Email, password: z.string().min(1).max(256), turnstile: z.string().max(2048) });
export type LoginRequest = z.infer<typeof LoginRequest>;

export const AuthUserResponse = z.strictObject({ id: z.uuid(), email: z.string() });
export type AuthUserResponse = z.infer<typeof AuthUserResponse>;


export const ConfigResponse = z.strictObject({ turnstileSiteKey: z.string() });
export type ConfigResponse = z.infer<typeof ConfigResponse>;

export const Plan = z.enum(["pro", "trial", "none"]);
export type Plan = z.infer<typeof Plan>;

export const BillingResponse = z.strictObject({ plan: Plan, subStatus: z.string(), periodEnd: z.iso.datetime().nullable(), cancelAtPeriodEnd: z.boolean(), trialEndsAt: z.iso.datetime() });
export type BillingResponse = z.infer<typeof BillingResponse>;

export const UrlResponse = z.strictObject({ url: z.url() });
export type UrlResponse = z.infer<typeof UrlResponse>;

export const EntitlementResponse = z.strictObject({ plan: Plan, capMicros: z.number().int().nonnegative() });
export type EntitlementResponse = z.infer<typeof EntitlementResponse>;

export const MeResponse = z.strictObject({ id: z.uuid(), email: z.string(), settings: z.record(z.string(), z.unknown()), entitlement: EntitlementResponse });
export type MeResponse = z.infer<typeof MeResponse>;

export const ModelsResponse = z.array(z.strictObject({ id: z.string(), label: z.string(), tier: z.enum(["trial", "pro"]) }));
export type ModelsResponse = z.infer<typeof ModelsResponse>;

const Micros = z.number().int().nonnegative();

export const LlmCallResponse = z.strictObject({ kind: z.string(), model: z.string(), promptTokens: z.number().int().nullable(), completionTokens: z.number().int().nullable(), costMicros: Micros, createdAt: z.iso.datetime() });
export type LlmCallResponse = z.infer<typeof LlmCallResponse>;

export const UsageResponse = z.strictObject({
  plan: Plan,
  period: z.iso.date(),
  usedMicros: Micros,
  reservedMicros: Micros,
  capMicros: Micros,
  byModel: z.array(z.strictObject({ model: z.string(), costMicros: Micros })),
  recent: z.array(LlmCallResponse),
});
export type UsageResponse = z.infer<typeof UsageResponse>;

export const StreamEvent = z.discriminatedUnion("t", [z.strictObject({ t: z.literal("d"), v: z.string() }), z.strictObject({ t: z.literal("end") }), z.strictObject({ t: z.literal("err"), code: z.string() })]);
export type StreamEvent = z.infer<typeof StreamEvent>;

export const Citation = z.strictObject({ n: z.int().min(1), paperId: z.string(), doi: z.string().nullable(), title: z.string(), year: z.int().nullable() });
export type Citation = z.infer<typeof Citation>;
