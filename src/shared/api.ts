import { z } from "zod";

export type ErrorCode = "bad_request"|"unauthenticated"|"forbidden_origin"|"not_found"|"rate_limited"|"payment_required"|"quota_exceeded"|"model_not_allowed"|"email_taken"|"bad_credentials"|"turnstile_failed"|"unsupported_media"|"too_large"|"already_subscribed"|"upstream"|"llm_bad_output"|"internal";

export const HealthResponse = z.strictObject({ ok: z.literal(true) });
export type HealthResponse = z.infer<typeof HealthResponse>;

export const ErrorResponse = z.strictObject({ error: z.string() });
export type ErrorResponse = z.infer<typeof ErrorResponse>;
