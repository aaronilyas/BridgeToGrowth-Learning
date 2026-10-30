# P03 · Auth: email and password, sessions, Turnstile

GOAL: Users can sign up, log in, log out and read `/api/me`, using opaque server-side sessions in an HttpOnly cookie. `route()` gains `auth`.

GIVEN: P00 and P01.

DELIVER: `src/server/auth/{core.ts,sql.ts,routes.ts,turnstile.ts}`, schemas appended to `src/shared/api.ts`, and an extended `route()`.

CONTRACT:
```
POST /api/auth/signup  {email: email≤254, password: string 12..256, turnstile: string≤2048}  → 201 {id,email} + Set-Cookie | 409 email_taken | 400 turnstile_failed
POST /api/auth/login   {email, password, turnstile}                                       → 200 {id,email} + Set-Cookie | 401 bad_credentials
POST /api/auth/logout  (auth)                                                             → 204, session row deleted, cookie cleared
GET  /api/me           (auth)                                                             → {id,email,settings}   (P04 adds entitlement)
GET  /api/config       (public)                                                           → {turnstileSiteKey}
RouteOpts.auth?: true  →  Ctx.user: {id, email, settings, trial_ends_at, sub_status, sub_period_end, sub_cancel_at_period_end}; missing or invalid → 401 unauthenticated
```
- Token: 32 bytes from `crypto.getRandomValues`, base64url-encoded. The DB stores only `sha256(token)` as `id_hash`.
- Cookie: `__Host-sid=<token>; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000`. Sessions expire after a fixed 30 days.
- Session lookup is one query: `sessions JOIN users ON id WHERE id_hash=$1 AND expires_at>now()`.
- `trial_ends_at` is set to `now() + TRIAL_DAYS` at signup.
- `verifyTurnstile(token, ip): Promise<boolean>` posts form data to `https://challenges.cloudflare.com/turnstile/v0/siteverify` with `{secret, response, remoteip}`. It returns true only if `success === true`, and in production also requires `hostname === new URL(APP_ORIGIN).hostname`. The timeout is 5 s; timing out counts as failure.

INV:
- Passwords use `Bun.password.hash` with argon2id (the default). A password over 256 characters is rejected before hashing (DoS guard).
- Login with an unknown email still runs `Bun.password.verify` against a fixed dummy hash computed once at boot. The response status and body are byte-identical to the wrong-password case. `// SEC: timing + enumeration parity`.
- Every successful login or signup inserts a new session. Session IDs are never reused. A user keeps at most 10 sessions; on insert, the oldest beyond 10 are deleted in the same transaction.
- Expired sessions are deleted hourly with `DELETE … WHERE expires_at < now()` (indexed).
- Rate limits: signup is 5/min per IP; login is 10/min per IP plus 5/min per lowercased email.
- Emails are lowercased and trimmed before use. Signup answers 409 for a taken email. `// SEC: accepted enumeration risk, mitigated by Turnstile and rate limits. Revisit when email verification exists.`
- Session lookup is O(1): a primary-key hash lookup plus a join on the users PK.

TESTS (max 3; real test DB; `verifyTurnstile` mocked to return true via `mock.module`):
1. signup, then `/api/me` (200), then logout (204), then `/api/me` with the same cookie (401).
2. Login with an unknown email and login with a wrong password return identical status and body.
3. A session row with `expires_at` in the past is treated as unauthenticated (401).

VERIFY: `bun run typecheck && bun test`. Run `curl` signup against the dev server with the Turnstile test keys and confirm a `Set-Cookie` header containing `__Host-sid` with `HttpOnly; Secure; SameSite=Lax`.

NO: password reset, email verification, OAuth, 2FA, UI.
