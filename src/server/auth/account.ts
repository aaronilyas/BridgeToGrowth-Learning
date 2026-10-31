import { DeleteAccountRequest, ForgotPasswordRequest, PasswordChangeRequest, ResetPasswordRequest } from "../../shared/api.ts";
import { env } from "../env.ts";
import { HttpError, route } from "../http.ts";
import { takeToken } from "../rate.ts";
import { createToken, formatClearCookie, hashToken, RESET_SECONDS } from "./core.ts";
import { deleteAccountCustomer } from "./customer.ts";
import { passwordResetEnabled, sendPasswordReset } from "./mail.ts";
import { buildSessionResponse, startSession } from "./routes.ts";
import { applyPasswordReset, clearUserStripe, deletePasswordReset, deleteUserAccount, findUserAuthRow, findUserCreds, passwordResetIsLive, rotateUserPassword, savePasswordReset } from "./sql.ts";
import { verifyTurnstile } from "./turnstile.ts";
import { verifyPassword } from "./verify.ts";

// O(1) plus one mail send
// SEC: an unknown email, disabled mail, and a failed send all finish as an empty success; the link is removed when it was not sent. The mail hop can change timing, which Turnstile and the per-email limit bound
async function issuePasswordReset(email: string): Promise<void> {
  if (!passwordResetEnabled()) return;
  const creds = await findUserCreds(email);
  if (!creds) return;
  const token = createToken();
  const tokenHash = hashToken(token);
  await savePasswordReset(creds.id, tokenHash, RESET_SECONDS);
  const sent = await sendPasswordReset(creds.email, `${env.APP_ORIGIN}/reset#${token}`);
  if (!sent) await deletePasswordReset(tokenHash);
}

const changePassword = route({ auth: true, body: PasswordChangeRequest, rate: { key: "password", cap: 5, perMin: 5 } }, async (c) => {
  const row = await findUserAuthRow(c.user.id);
  const ok = await verifyPassword(c.body.currentPassword, row?.pw_hash ?? null);
  if (!row || !ok) throw new HttpError(401, "wrong_password");
  if (c.body.newPassword === c.body.currentPassword) throw new HttpError(400, "bad_request");
  const token = createToken();
  const hash = await Bun.password.hash(c.body.newPassword, "argon2id");
  if (!(await rotateUserPassword(c.user.id, hash, hashToken(token)))) throw new HttpError(401, "unauthenticated");
  return buildSessionResponse(c.user.id, c.user.email, token, 200);
});

const forgotPassword = route({ body: ForgotPasswordRequest, rate: { key: "forgot", cap: 5, perMin: 5 } }, async (c) => {
  if (!takeToken(`forgot-email:${c.body.email}`, 3, 3)) throw new HttpError(429, "rate_limited");
  if (!(await verifyTurnstile(c.body.turnstile, c.ip))) throw new HttpError(400, "turnstile_failed");
  await issuePasswordReset(c.body.email);
  return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
});

const resetPassword = route({ body: ResetPasswordRequest, rate: { key: "reset", cap: 10, perMin: 10 } }, async (c) => {
  const tokenHash = hashToken(c.body.token);
  // SEC: argon2id runs only for a live link, so an unknown token cannot force a hash
  if (!(await passwordResetIsLive(tokenHash))) throw new HttpError(400, "bad_request");
  const hash = await Bun.password.hash(c.body.password, "argon2id");
  const user = await applyPasswordReset(tokenHash, hash);
  if (!user) throw new HttpError(400, "bad_request");
  return startSession(user.id, user.email, 200);
});

// INV: Stripe is deleted before the local billing link is cleared; a failed Stripe call keeps the live subscription. The user row is removed only after that link is cleared
// SEC: the current password is required again so a signed-in browser cannot delete the account without it
const deleteAccount = route({ auth: true, body: DeleteAccountRequest, rate: { key: "delete-account", cap: 5, perMin: 5 } }, async (c) => {
  const row = await findUserAuthRow(c.user.id);
  const ok = await verifyPassword(c.body.password, row?.pw_hash ?? null);
  if (!row || !ok) throw new HttpError(401, "wrong_password");
  if (row.stripe_customer_id) {
    await deleteAccountCustomer(row.stripe_customer_id);
    await clearUserStripe(c.user.id);
  }
  await deleteUserAccount(c.user.id);
  return new Response(null, { status: 204, headers: { "set-cookie": formatClearCookie(), "cache-control": "no-store" } });
});

export const accountRoutes = {
  "/api/auth/password": { POST: changePassword },
  "/api/auth/forgot": { POST: forgotPassword },
  "/api/auth/reset": { POST: resetPassword },
  "/api/account": { DELETE: deleteAccount },
};
