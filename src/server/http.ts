import type { z } from "zod";
import type { ErrorCode, Plan } from "../shared/api.ts";
import { env } from "./env.ts";
import { hashToken, readSessionToken, type AuthUser } from "./auth/core.ts";
import { findSession } from "./auth/sql.ts";
import { entitlementOf } from "./billing/core.ts";
import { takeToken } from "./rate.ts";

export class HttpError extends Error {
  constructor(readonly status: number, readonly code: ErrorCode) {
    super(code);
  }
}

// O(n) in body size
// SEC: read incrementally so chunked bodies cannot bypass the configured cap
export async function readBodyCapped(req: Request, cap: number): Promise<Uint8Array> {
  const reader = req.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      size += result.value.byteLength;
      if (size > cap) {
        await reader.cancel();
        throw new HttpError(413, "too_large");
      }
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export type Ctx<B, A extends boolean = false, E extends boolean = false> = {
  req: Request;
  ip: string;
  params: Record<string, string>;
  body: B;
  user: true extends A | E ? AuthUser : undefined;
  plan: true extends A | E ? Plan : undefined;
  capMicros: true extends A | E ? bigint : undefined;
};
export type RouteOpts<B, A extends boolean = false, E extends boolean = false> = { auth?: A; entitled?: E; pro?: boolean; body?: z.ZodType<B>; rate?: { key: string; cap: number; perMin: number }; csrf?: boolean; maxBody?: number; raw?: boolean };

const JSON_HEADERS = { "content-type": "application/json", "cache-control": "no-store" };
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(["localhost", "127.0.0.1", "::1"]);
const SECURITY_HEADERS: ReadonlyArray<readonly [string, string]> = [
  ["content-security-policy", "default-src 'self'; script-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"],
  ["x-content-type-options", "nosniff"],
  ["referrer-policy", "strict-origin-when-cross-origin"],
  ["permissions-policy", "camera=(), microphone=(), geolocation=()"],
];
const HSTS = "max-age=15552000; includeSubDomains";

// O(1)
// SEC: HSTS is production-only so a local http origin is not pinned
function applySecurityHeaders(headers: Headers): void {
  for (const [name, value] of SECURITY_HEADERS) headers.set(name, value);
  if (env.NODE_ENV === "production") headers.set("strict-transport-security", HSTS);
}

// O(1)
// INV: 204, 205 and 304 stay bodyless so the Fetch API accepts them
export function secureResponse(res: Response): Response {
  const headers = new Headers();
  for (const [name, value] of res.headers) {
    if (name === "set-cookie") continue;
    headers.append(name, value);
  }
  for (const cookie of res.headers.getSetCookie()) headers.append("set-cookie", cookie);
  applySecurityHeaders(headers);
  if (res.status === 204 || res.status === 205 || res.status === 304) return new Response(null, { status: res.status, statusText: res.statusText, headers });
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

// O(1)
// SEC: the browser sets Origin, so another site cannot claim a loopback origin; localhost, 127.0.0.1, and ::1 are one local app when the scheme and port match
export function originAllowed(header: string | null, appOrigin: string): boolean {
  if (header === null) return false;
  let sent: URL;
  let allowed: URL;
  try {
    sent = new URL(header);
    allowed = new URL(appOrigin);
  } catch {
    return false;
  }
  if (sent.origin === allowed.origin) return true;
  if (sent.protocol !== allowed.protocol || sent.port !== allowed.port) return false;
  const sentHost = sent.hostname.startsWith("[") && sent.hostname.endsWith("]") ? sent.hostname.slice(1, -1) : sent.hostname;
  const allowedHost = allowed.hostname.startsWith("[") && allowed.hostname.endsWith("]") ? allowed.hostname.slice(1, -1) : allowed.hostname;
  return LOOPBACK_HOSTS.has(sentHost) && LOOPBACK_HOSTS.has(allowedHost);
}

// O(n) in body size
export function json(data: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

// O(1)
// SEC: X-Real-IP is trustworthy only because the server binds to 127.0.0.1 and Caddy overwrites that header; a missing header shares the "local" bucket
function readIp(req: Request): string {
  return req.headers.get("x-real-ip") ?? "local";
}

// O(1)
// INV: free-plan settings are not configurable, so a free user is served the defaults; the stored settings return on upgrade
function applyPlanSettings(u: AuthUser, plan: Plan): AuthUser {
  return plan === "pro" ? u : { ...u, settings: {} };
}

// O(n) in body size
// INV: check order is size, csrf, session, pro gate, rate limit, body parse, handler
// INV: raw skips body parsing so the handler reads the stream itself (multipart); size is capped by content-length here and by the handler
// INV: auth, entitled and pro all require a session; every account has an entitlement, pro also requires the pro plan (402 pro_required)
// INV: rate buckets are per user on authenticated routes and per client IP otherwise
export function route<B = undefined, A extends boolean = false, E extends boolean = false>(opts: RouteOpts<B, A, E>, fn: (c: Ctx<B, A, E>) => Promise<Response>): (req: Request & { params?: Record<string, string> }) => Promise<Response> {
  const maxBody = opts.maxBody ?? 64 * 1024;
  return async (req) => {
    try {
      const len = Number(req.headers.get("content-length") ?? 0);
      if (len > maxBody) throw new HttpError(413, "too_large");
      const csrf = opts.csrf ?? (req.method !== "GET" && req.method !== "HEAD");
      if (csrf && !originAllowed(req.headers.get("origin"), env.APP_ORIGIN)) throw new HttpError(403, "forbidden_origin");
      const ip = readIp(req);
      let user: AuthUser | undefined;
      let ent: { plan: Plan; capMicros: bigint } | undefined;
      if (opts.auth || opts.entitled || opts.pro) {
        const token = readSessionToken(req.headers.get("cookie"));
        const found = token ? await findSession(hashToken(token)) : null;
        if (!found) throw new HttpError(401, "unauthenticated");
        ent = entitlementOf(found);
        if (opts.pro && ent.plan !== "pro") throw new HttpError(402, "pro_required");
        user = applyPlanSettings(found, ent.plan);
      }
      if (opts.rate && !takeToken(`${opts.rate.key}:${user ? `u:${user.id}` : `ip:${ip}`}`, opts.rate.cap, opts.rate.perMin)) throw new HttpError(429, "rate_limited");
      let body = undefined as B;
      if (opts.body && !opts.raw) {
        const text = new TextDecoder().decode(await readBodyCapped(req, maxBody));
        let raw: unknown;
        try {
          raw = JSON.parse(text);
        } catch {
          throw new HttpError(400, "bad_request");
        }
        const r = opts.body.safeParse(raw);
        if (!r.success) throw new HttpError(400, "bad_request");
        body = r.data;
      }
      return secureResponse(await fn({ req, ip, params: req.params ?? {}, body, user: user as Ctx<B, A, E>["user"], plan: ent?.plan as Ctx<B, A, E>["plan"], capMicros: ent?.capMicros as Ctx<B, A, E>["capMicros"] }));
    } catch (e) {
      if (e instanceof HttpError) return secureResponse(json({ error: e.code }, e.status));
      console.error("request failed");
      return secureResponse(json({ error: "internal" }, 500));
    }
  };
}
