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

export const MeResponse = z.strictObject({ id: z.uuid(), email: z.string(), settings: z.record(z.string(), z.unknown()) });
export type MeResponse = z.infer<typeof MeResponse>;

export const ConfigResponse = z.strictObject({ turnstileSiteKey: z.string() });
export type ConfigResponse = z.infer<typeof ConfigResponse>;
