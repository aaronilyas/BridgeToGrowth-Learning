import type { z } from "zod";
import type { ErrorCode, Plan } from "../shared/api.ts";
import { env } from "./env.ts";
import type { LocalUser } from "./local/core.ts";
import { ensureLocalUser } from "./local/sql.ts";
import { takeToken } from "./rate.ts";

export class HttpError extends Error {
  constructor(readonly status: number, readonly code: ErrorCode) {
    super(code);
  }
}

export type Ctx<B, A extends boolean = false, E extends boolean = false> = {
  req: Request;
  ip: string;
  params: Record<string, string>;
  body: B;
  user: true extends A | E ? LocalUser : undefined;
  plan: true extends E ? Plan : undefined;
  capMicros: true extends E ? bigint : undefined;
};
export type RouteOpts<B, A extends boolean = false, E extends boolean = false> = { auth?: A; entitled?: E; body?: z.ZodType<B>; rate?: { key: string; cap: number; perMin: number }; csrf?: boolean; maxBody?: number; raw?: boolean };

const JSON_HEADERS = { "content-type": "application/json", "cache-control": "no-store", "x-content-type-options": "nosniff" };
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(["localhost", "127.0.0.1", "::1"]);

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
// SEC: the server binds to 127.0.0.1, so every caller shares one local rate bucket
function readIp(): string {
  return "local";
}

// O(1)
// INV: capMicros 0 means the free router has no dollar cap
export function freeEntitlement(): { plan: Plan; capMicros: bigint } {
  return { plan: "free", capMicros: 0n };
}

// O(n) in body size
// INV: check order is size, csrf, rate limit, local user, body parse, handler
// INV: raw skips body parsing so the handler reads the stream itself (multipart); size is capped by content-length here and by the handler
// INV: auth and entitled both load the single local user; entitled also sets the free entitlement
export function route<B = undefined, A extends boolean = false, E extends boolean = false>(opts: RouteOpts<B, A, E>, fn: (c: Ctx<B, A, E>) => Promise<Response>): (req: Request & { params?: Record<string, string> }) => Promise<Response> {
  const maxBody = opts.maxBody ?? 64 * 1024;
  return async (req) => {
    try {
      const len = Number(req.headers.get("content-length") ?? 0);
      if (len > maxBody) throw new HttpError(413, "too_large");
      const csrf = opts.csrf ?? (req.method !== "GET" && req.method !== "HEAD");
      if (csrf && !originAllowed(req.headers.get("origin"), env.APP_ORIGIN)) throw new HttpError(403, "forbidden_origin");
      const ip = readIp();
      if (opts.rate && !takeToken(`${opts.rate.key}:${ip}`, opts.rate.cap, opts.rate.perMin)) throw new HttpError(429, "rate_limited");
      let user: LocalUser | undefined;
      if (opts.auth || opts.entitled) user = await ensureLocalUser();
      const ent = opts.entitled ? freeEntitlement() : undefined;
      let body = undefined as B;
      if (opts.body && !opts.raw) {
        const text = await req.text();
        if (new TextEncoder().encode(text).length > maxBody) throw new HttpError(413, "too_large");
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
      return await fn({ req, ip, params: req.params ?? {}, body, user: user as Ctx<B, A, E>["user"], plan: ent?.plan as Ctx<B, A, E>["plan"], capMicros: ent?.capMicros as Ctx<B, A, E>["capMicros"] });
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.code }, e.status);
      console.error("request failed");
      return json({ error: "internal" }, 500);
    }
  };
}
