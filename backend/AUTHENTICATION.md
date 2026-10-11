# Accounts and mobile API contract

The Python backend owns credentials, phone verification, accounts and sessions.
Photon only transports messages through the private TypeScript service. There
is no external identity provider, introspection endpoint, JWT, or verification
bypass. All examples below use placeholders, never real credentials.

## JSON conventions and errors

Use HTTPS and `Content-Type: application/json`. All bodies reject unknown fields.
Phone numbers must be E.164 (`+`, a nonzero country code, 8–15 digits).
Passwords are 12–128 characters, preserved exactly (including whitespace).
Verification codes are six digits, including leading zeroes; send them as strings.
Challenge/account/lesson IDs are UUID strings. Responses have `Cache-Control:
no-store`. The authenticated endpoints require `Authorization: Bearer <access_token>`.

Errors are `{ "detail": "message" }`, except malformed bodies, whose 422 `detail`
is an array of `{ "loc": [...], "type": "...", "msg": "..." }` without the input.
401 credentials errors include `WWW-Authenticate: Bearer`; 429 includes
`Retry-After: 900`. Never display provider errors, traceback text, or credentials.
Signup, recovery, enrollment and resend deliberately provide generic responses
for ineligible/occupied/unknown recipients, cooldowns and transport failures.
A successful request response does not prove a verification message was sent.
Delivery runs after the HTTP response; if it is interrupted, use bounded resend.

## Signup, verification and legacy enrollment

| Endpoint | Request | Success |
| --- | --- | --- |
| `POST /auth/signup` | `{ "phone_number": "+15551234567", "password": "<password>" }` | 202 challenge response |
| `POST /auth/verify` | `{ "challenge_id": "<uuid>", "code": "012345" }` | 200 token response + account |
| `POST /auth/enrollment` | Signup fields plus `"enrollment_token": "<operator invitation>"` | 202 challenge response |
| `POST /auth/enrollment/verify` | Same body as `/auth/verify` | 200 token response + preserved account |
| `POST /auth/resend` | `{ "challenge_id": "<uuid>" }` | 202 `{ "message": "If eligible, a verification message will be sent", "resend_after": 60 }` |

Challenge response:

```json
{
  "challenge_id": "<uuid>",
  "expires_in": 600,
  "resend_after": 60,
  "message": "If eligible, a verification message will be sent"
}
```

New signup stores a pending Argon2id password hash and code HMAC, and creates
an account/container metadata record only after successful phone verification.
No container starts during signup. Duplicate signup cannot overwrite an existing
password or attach to an existing UUID. Codes expire after ten minutes, allow
five failed or successful attempts in total, and are consumed atomically once.
Resend replaces the code after a recipient-wide 60-second cooldown; it does not
reset the attempt counter or extend absolute expiry. Use the original eligible
challenge for resend. After it expires, begin a new request. An ineligible or
cooldown-only challenge cannot later become eligible by resending it.

Legacy accounts have no password and no verified flag after migration. An
operator first authenticates the original account holder through an established
trusted channel, confirms the account UUID and current recipient, and issues an
invitation with `python -m backend.enroll <account-uuid>`. That command stores only
the invitation's SHA-256 hash and 24-hour expiry; stdout is the one-time secret
for secure handoff. Do not put the invitation in logs, URLs or source files.
Enrollment requires BOTH that invitation and successful verification of the
account's stored phone. It updates that same UUID without breaking containers,
lesson ownership or delivery relationships. Invitation issuance alone never
verifies a phone or grants a session. If a legacy number is no longer controlled
by its original holder, stop enrollment and resolve ownership through operator
support; do not grant historical lessons to a recycled-number holder.

## Login, renewal, logout and current account

| Endpoint | Request | Success |
| --- | --- | --- |
| `POST /auth/login` | `{ "phone_number": "+15551234567", "password": "<password>" }` | 200 token response + account |
| `POST /auth/refresh` | `{ "refresh_token": "<opaque token>" }` | 200 token response (no account field) |
| `POST /auth/logout` | No body; access bearer required | 204, revokes current session |
| `POST /auth/logout-all` | No body; access bearer required | 204, revokes all account sessions |
| `GET /account` | Access bearer required | 200 account response |

Token response:

```json
{
  "token_type": "Bearer",
  "access_token": "<opaque random token>",
  "refresh_token": "<opaque random token>",
  "expires_in": 900,
  "refresh_expires_in": 2592000,
  "account": { "id": "<uuid>", "phone_number": "+15551234567", "phone_verified": true }
}
```

Access tokens live for 15 minutes; sessions/refresh tokens have a 30-day absolute
expiry, which renewal does not extend. Rotation consumes the old refresh token
and invalidates older access tokens for that session. Reuse of a consumed refresh
token revokes its entire session family, including newly issued tokens. Other
independent sessions remain valid until logout-all or a security change.
Only SHA-256 hashes of cryptographically random 256-bit tokens are stored.
Consumed refresh hashes remain available for reuse detection through family
expiry. Revocation is checked in PostgreSQL on each protected request.

Keep access tokens in memory where practical and refresh tokens in the mobile
OS Keychain/Keystore; never AsyncStorage, analytics, URLs, crash logs or clipboard.
Do not store the password. Serialize refresh requests across the whole mobile
client, atomically replace BOTH tokens, and do not retry with an old refresh
token after an uncertain refresh response: reauthenticate instead. Clear local
tokens on logout or 401; logout-all, recovery and phone changes revoke server
sessions, so clearing local storage alone is insufficient. A client that only
has an expired access token can renew first or discard local tokens and wait for
server expiry. Honor `expires_in`, `refresh_expires_in` and throttling responses.

Account response is exactly `{ "id": "<uuid>", "phone_number": "+15551234567",
"phone_verified": true }`. The previous `PUT /account` registration route has
been removed. Account ID and lesson recipient always come from server state.

## Recovery and phone changes

| Endpoint | Request | Success |
| --- | --- | --- |
| `POST /auth/recovery` | `{ "phone_number": "+15551234567" }` | 202 challenge response |
| `POST /auth/reset` | `{ "challenge_id": "<uuid>", "code": "012345", "new_password": "<password>" }` | 200 `{ "message": "Account updated; log in again" }` |
| `POST /account/phone` | Access bearer; `{ "phone_number": "<new E.164 recipient>", "password": "<current password>" }` | 202 challenge response sent to new phone if eligible |
| `POST /account/phone/verify` | Access bearer; `{ "challenge_id": "<uuid>", "code": "012345" }` | 200 same account-updated response |

Recovery applies only to enrolled, verified accounts. Reset revokes every session;
log in with the new password afterwards. Phone changes require both password
reauthentication and verification of an unoccupied new recipient. Verification
is bound to the authenticated UUID and the password hash at request time; stale
security challenges cannot overwrite later password changes. Successful phone
change revokes every session. Reauthenticate using the new phone. The delivery
recipient is captured at the atomic messaging cutoff, so an already-started
send can still reach the previously verified recipient; it is never retracted.
Historical receipts use the captured send-time phone, not the account's new one.

Limits persist in PostgreSQL: each operation allows at most 30 requests per
client address and ten per subject in 15 minutes. Code requests share a limit
across signup/enrollment/recovery/phone-change; verification shares one across
purposes. Phone-change reauthentication also has an account-wide limit.
No unauthenticated or refresh/recovery request updates container inactivity.
Successful access-bearer authentication on account/lesson/logout routes updates
activity, including polls and authenticated rejected lesson bodies.

Deploy behind the documented private loopback origin. If using forwarded client
addresses, configure Uvicorn's `FORWARDED_ALLOW_IPS` only for the connector's
specific trusted source address; never trust arbitrary client headers or `*`.
Without that configuration, clients sharing a proxy share the address limit.
