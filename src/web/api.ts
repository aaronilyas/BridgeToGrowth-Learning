import type { z } from "zod";
import type { ErrorCode } from "../shared/api.ts";

export type ApiError = Error & { status: number; code: ErrorCode };
export type ApiInit = { method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"; body?: unknown };

const CODES: ReadonlySet<string> = new Set<ErrorCode>(["bad_request", "forbidden_origin", "not_found", "rate_limited", "quota_exceeded", "model_not_allowed", "unsupported_media", "too_large", "upstream", "llm_bad_output", "internal"]);

const MESSAGES: Record<ErrorCode, string> = {
  bad_request: "That request wasn't valid. Check the fields and try again.",
  forbidden_origin: "Request blocked. Reload the page.",
  not_found: "Not found.",
  rate_limited: "Too many attempts. Wait a minute and retry.",
  quota_exceeded: "You've reached this month's usage cap.",
  model_not_allowed: "That model isn't the Free Models Router.",
  unsupported_media: "Only PDF or PNG files are accepted.",
  too_large: "That's too large.",
  upstream: "A provider is unavailable. Try again shortly.",
  llm_bad_output: "The model returned something unusable. Try again.",
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
