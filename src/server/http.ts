import type { z } from "zod";
import type { ErrorCode } from "../shared/api.ts";
import { env } from "./env.ts";
import { hashToken, readSessionToken, type AuthUser } from "./auth/core.ts";
import { findSession } from "./auth/sql.ts";
import { takeToken } from "./rate.ts";

export class HttpError extends Error {
  constructor(readonly status: number, readonly code: ErrorCode) {
    super(code);
  }
}

export type Ctx<B, A extends boolean = false> = { req: Request; ip: string; params: Record<string, string>; body: B; user: A extends true ? AuthUser : undefined };
export type RouteOpts<B, A extends boolean = false> = { auth?: A; body?: z.ZodType<B>; rate?: { key: string; cap: number; perMin: number }; csrf?: boolean; maxBody?: number };

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
export function route<B = undefined, A extends boolean = false>(opts: RouteOpts<B, A>, fn: (c: Ctx<B, A>) => Promise<Response>): (req: Request & { params?: Record<string, string> }) => Promise<Response> {
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
      if (opts.auth) {
        const token = readSessionToken(req.headers.get("cookie"));
        const found = token ? await findSession(hashToken(token)) : null;
        if (!found) throw new HttpError(401, "unauthenticated");
        user = found;
      }
      let body = undefined as B;
      if (opts.body) {
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
      return await fn({ req, ip, params: req.params ?? {}, body, user: user as Ctx<B, A>["user"] });
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.code }, e.status);
      console.error(e instanceof Error ? `${e.message}\n${e.stack ?? ""}` : "non-error thrown");
      return json({ error: "internal" }, 500);
    }
  };
}
