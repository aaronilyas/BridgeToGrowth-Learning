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

export type Ctx<B, A extends boolean = false, E extends boolean = false> = {
  req: Request;
  ip: string;
  params: Record<string, string>;
  body: B;
  user: true extends A | E ? AuthUser : undefined;
  plan: true extends E ? Plan : undefined;
  capMicros: true extends E ? bigint : undefined;
};
export type RouteOpts<B, A extends boolean = false, E extends boolean = false> = { auth?: A; entitled?: E; body?: z.ZodType<B>; rate?: { key: string; cap: number; perMin: number }; csrf?: boolean; maxBody?: number; raw?: boolean };

const JSON_HEADERS = { "content-type": "application/json", "cache-control": "no-store", "x-content-type-options": "nosniff" };

// O(n) in body size
export function json(data: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

// O(1)
// SEC: cf-connecting-ip is trustworthy only because the server binds to 127.0.0.1 and cloudflared is the only ingress
function readIp(req: Request): string {
  return req.headers.get("cf-connecting-ip") ?? "local";
}

// O(n) in body size
// INV: check order is size, csrf, rate limit, auth, body parse, handler
// INV: raw skips body parsing so the handler reads the stream itself (multipart); size is capped by content-length here and by the handler
// INV: entitled implies auth; plan none is 402, decided from the session row with no extra query
export function route<B = undefined, A extends boolean = false, E extends boolean = false>(opts: RouteOpts<B, A, E>, fn: (c: Ctx<B, A, E>) => Promise<Response>): (req: Request & { params?: Record<string, string> }) => Promise<Response> {
  const maxBody = opts.maxBody ?? 64 * 1024;
  return async (req) => {
    try {
      const len = Number(req.headers.get("content-length") ?? 0);
      if (len > maxBody) throw new HttpError(413, "too_large");
      const csrf = opts.csrf ?? (req.method !== "GET" && req.method !== "HEAD");
      if (csrf && req.headers.get("origin") !== env.APP_ORIGIN) throw new HttpError(403, "forbidden_origin");
      const ip = readIp(req);
      if (opts.rate && !takeToken(`${opts.rate.key}:${ip}`, opts.rate.cap, opts.rate.perMin)) throw new HttpError(429, "rate_limited");
      let user: AuthUser | undefined;
      if (opts.auth || opts.entitled) {
        const token = readSessionToken(req.headers.get("cookie"));
        const found = token ? await findSession(hashToken(token)) : null;
        if (!found) throw new HttpError(401, "unauthenticated");
        user = found;
      }
      let ent: { plan: Plan; capMicros: bigint } | undefined;
      if (opts.entitled && user) {
        ent = entitlementOf(user, new Date());
        if (ent.plan === "none") throw new HttpError(402, "payment_required");
      }
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
