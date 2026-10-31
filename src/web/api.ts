import type { z } from "zod";
import type { ErrorCode } from "../shared/api.ts";

export type ApiError = Error & { status: number; code: ErrorCode };
export type ApiInit = { method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"; body?: unknown };

const CODES: ReadonlySet<string> = new Set<ErrorCode>(["bad_request", "unauthenticated", "forbidden_origin", "not_found", "rate_limited", "pro_required", "quota_exceeded", "email_taken", "bad_credentials", "turnstile_failed", "already_subscribed", "model_not_allowed", "unsupported_media", "too_large", "upstream", "llm_bad_output", "source_blocked", "source_unreadable", "sandbox_unavailable", "internal"]);

const MESSAGES: Record<ErrorCode, string> = {
  bad_request: "That request wasn't valid. Check the fields and try again.",
  unauthenticated: "Your session has ended. Sign in again.",
  forbidden_origin: "Request blocked. Reload the page.",
  not_found: "Not found.",
  rate_limited: "Too many attempts. Wait a minute and retry.",
  pro_required: "That's a Pro feature. Upgrade to unlock it.",
  quota_exceeded: "You've reached this month's usage cap.",
  email_taken: "An account with that email already exists. Sign in instead.",
  bad_credentials: "That email and password don't match.",
  turnstile_failed: "The human check failed. Try it again.",
  already_subscribed: "You already have a Pro subscription.",
  model_not_allowed: "That model isn't available.",
  unsupported_media: "That file or link type isn't supported. Question styles take PDF or PNG; lesson attachments take PDFs, web pages or plain text.",
  too_large: "That's too large.",
  upstream: "A provider is unavailable. Try again shortly.",
  llm_bad_output: "The model returned something unusable. Try again.",
  source_blocked: "That link points to a local or private address, a non-standard port, or isn't http(s), so it can't be fetched.",
  source_unreadable: "One of your attachments or links couldn't be read. Check that the PDF isn't encrypted or damaged and the link is public.",
  sandbox_unavailable: "Code can't run here: the server's sandbox (bubblewrap, prlimit and /usr/bin/python3) isn't available.",
  internal: "Something went wrong.",
};

// O(1)
export function makeApiError(status: number, code: string): ApiError {
  const c: ErrorCode = CODES.has(code) ? (code as ErrorCode) : "internal";
  return Object.assign(new Error(c), { name: "ApiError", status, code: c });
}

// O(1)
export function isApiError(e: unknown): e is ApiError {
  return e instanceof Error && e.name === "ApiError" && "code" in e && "status" in e;
}

// O(1)
export function describeError(e: unknown): string {
  return MESSAGES[isApiError(e) ? e.code : "internal"];
}

// O(n) in response size
export async function readApiError(res: Response): Promise<ApiError> {
  const body: unknown = await res.json().catch(() => null);
  const code = typeof body === "object" && body !== null && "error" in body && typeof body.error === "string" ? body.error : "internal";
  return makeApiError(res.status, code);
}

// O(n) in request + response size
// INV: same-origin cookies only; FormData is sent as multipart, anything else as JSON; 204 parses `undefined`
// INV: the response is validated by `schema`, so a server/client drift surfaces as an ApiError, not a silent bad value
export async function api<T>(path: string, schema: z.ZodType<T>, init: ApiInit = {}): Promise<T> {
  const headers: Record<string, string> = { accept: "application/json" };
  let body: BodyInit | undefined;
  if (init.body instanceof FormData) body = init.body;
  else if (init.body !== undefined) {
    body = JSON.stringify(init.body);
    headers["content-type"] = "application/json";
  }
  let res: Response;
  try {
    res = await fetch(path, { method: init.method ?? (body === undefined ? "GET" : "POST"), credentials: "same-origin", headers, ...(body === undefined ? {} : { body }) });
  } catch {
    throw makeApiError(0, "upstream");
  }
  if (!res.ok) throw await readApiError(res);
  const data: unknown = res.status === 204 ? undefined : await res.json().catch(() => null);
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw makeApiError(res.status, "internal");
  return parsed.data;
}
