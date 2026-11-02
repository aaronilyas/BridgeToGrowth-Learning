import { ConfigResponse, LoginRequest, SignupRequest, type AuthUserResponse, type MeResponse } from "../../shared/api.ts";
import { readPlanTerms } from "../billing/core.ts";
import { env } from "../env.ts";
import { HttpError, json, route } from "../http.ts";
import { takeToken } from "../rate.ts";
import { createToken, formatClearCookie, formatSessionCookie, hashToken, readSessionToken } from "./core.ts";
import { passwordResetEnabled } from "./mail.ts";
import { deleteSession, findUserCreds, insertSession, insertUser } from "./sql.ts";
import { verifyTurnstile } from "./turnstile.ts";
import { verifyPassword } from "./verify.ts";
import { readAdsConfig } from "../ads/routes.ts";

// O(1)
export function buildSessionResponse(uid: string, email: string, token: string, status: number): Response {
  const res = json({ id: uid, email } satisfies AuthUserResponse, status);
  res.headers.append("set-cookie", formatSessionCookie(token));
  return res;
}

// O(log n + MAX_SESSIONS)
// INV: the cookie carries the raw token and the database stores only its hash
export async function startSession(uid: string, email: string, status: number): Promise<Response> {
  const token = createToken();
  await insertSession(uid, hashToken(token));
  return buildSessionResponse(uid, email, token, status);
}

const signup = route({ body: SignupRequest, rate: { key: "signup", cap: 5, perMin: 5 } }, async (c) => {
  if (!(await verifyTurnstile(c.body.turnstile, c.ip))) throw new HttpError(400, "turnstile_failed");
  const hash = await Bun.password.hash(c.body.password, "argon2id");
  const user = await insertUser(c.body.email, hash);
  // SEC: accepted enumeration risk, mitigated by Turnstile and rate limits. Revisit when email verification exists.
  if (!user) throw new HttpError(409, "email_taken");
  return startSession(user.id, user.email, 201);
});

const login = route({ body: LoginRequest, rate: { key: "login", cap: 10, perMin: 10 } }, async (c) => {
  // SEC: Turnstile runs before the per-email bucket, so requests without a solved challenge cannot lock an email out; the token is spent before the password check so parallel guesses cannot overrun the bucket
  if (!(await verifyTurnstile(c.body.turnstile, c.ip))) throw new HttpError(400, "turnstile_failed");
  if (!takeToken(`login-email:${c.body.email}`, 5, 5)) throw new HttpError(429, "rate_limited");
  const creds = await findUserCreds(c.body.email);
  // SEC: timing + enumeration parity
  const ok = await verifyPassword(c.body.password, creds?.pw_hash ?? null);
  if (!creds || !ok) throw new HttpError(401, "bad_credentials");
  return startSession(creds.id, creds.email, 200);
});

const logout = route({ auth: true }, async (c) => {
  const token = readSessionToken(c.req.headers.get("cookie"));
  if (token) await deleteSession(c.user.id, hashToken(token));
  return new Response(null, { status: 204, headers: { "set-cookie": formatClearCookie(), "cache-control": "no-store" } });
});

const me = route({ auth: true }, async (c) => json({ id: c.user.id, email: c.user.email, settings: c.user.settings, entitlement: { plan: c.plan, capMicros: Number(c.capMicros) } } satisfies MeResponse));

const config = route({}, async () => json(ConfigResponse.parse({ turnstileSiteKey: env.TURNSTILE_SITE_KEY, plans: readPlanTerms(), passwordReset: passwordResetEnabled(), ads: readAdsConfig() })));

export const authRoutes = {
  "/api/auth/signup": { POST: signup },
  "/api/auth/login": { POST: login },
  "/api/auth/logout": { POST: logout },
  "/api/me": { GET: me },
  "/api/config": { GET: config },
};
