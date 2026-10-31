import { sql } from "../db.ts";
import { LEGACY_LOCAL_EMAIL, MAX_SESSIONS, SESSION_SECONDS, type AuthUser } from "./core.ts";

export type UserCreds = { id: string; email: string; pw_hash: string };

// O(log n)
// INV: ON CONFLICT makes concurrent duplicate signups race-safe
export async function insertUser(email: string, pwHash: string): Promise<{ id: string; email: string } | null> {
  const rows: { id: string; email: string }[] = await sql`
    INSERT INTO users (email, pw_hash) VALUES (${email}, ${pwHash})
    ON CONFLICT (email) DO NOTHING
    RETURNING id, email`;
  return rows[0] ?? null;
}

// O(log n)
export async function findUserCreds(email: string): Promise<UserCreds | null> {
  const rows: UserCreds[] = await sql`SELECT id, email, pw_hash FROM users WHERE email = ${email} LIMIT 1`;
  return rows[0] ?? null;
}

// O(log n + MAX_SESSIONS)
// INV: insert and trim to MAX_SESSIONS happen in one transaction
export async function insertSession(uid: string, idHash: Uint8Array): Promise<void> {
  await sql.begin(async (tx) => {
    await tx`INSERT INTO sessions (id_hash, user_id, expires_at) VALUES (${idHash}, ${uid}, now() + make_interval(secs => ${SESSION_SECONDS}))`;
    await tx`
      DELETE FROM sessions WHERE user_id = ${uid} AND id_hash NOT IN (
        SELECT id_hash FROM sessions WHERE user_id = ${uid} ORDER BY expires_at DESC, id_hash LIMIT ${MAX_SESSIONS})`;
  });
}

// O(1)
// SEC: the session token is the credential; uid comes from this lookup, never from the client
export async function findSession(idHash: Uint8Array): Promise<AuthUser | null> {
  const rows: AuthUser[] = await sql`
    SELECT u.id, u.email, u.settings, u.stripe_customer_id, u.sub_id, u.sub_status, u.sub_period_end, u.sub_cancel_at_period_end
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.id_hash = ${idHash} AND s.expires_at > now()`;
  return rows[0] ?? null;
}

// O(log n)
export async function deleteSession(uid: string, idHash: Uint8Array): Promise<void> {
  await sql`DELETE FROM sessions WHERE id_hash = ${idHash} AND user_id = ${uid}`;
}

// O(k) in expired rows, via sessions_expires_idx
export async function deleteExpiredSessions(): Promise<void> {
  await sql`DELETE FROM sessions WHERE expires_at < now()`;
}

// O(log n + sessions)
// INV: a password change ends every session and outstanding reset link of that user in the same transaction
export async function setUserPassword(email: string, pwHash: string): Promise<boolean> {
  return sql.begin(async (tx) => {
    const rows: { id: string }[] = await tx`UPDATE users SET pw_hash = ${pwHash} WHERE email = ${email} RETURNING id`;
    const row = rows[0];
    if (!row) return false;
    await tx`DELETE FROM sessions WHERE user_id = ${row.id}`;
    await tx`DELETE FROM password_resets WHERE user_id = ${row.id}`;
    return true;
  });
}

export type UserAuthRow = { pw_hash: string; stripe_customer_id: string | null };

// O(1)
// SEC: uid comes from the session, never from the client
export async function findUserAuthRow(uid: string): Promise<UserAuthRow | null> {
  const rows: UserAuthRow[] = await sql`SELECT pw_hash, stripe_customer_id FROM users WHERE id = ${uid} LIMIT 1`;
  return rows[0] ?? null;
}

// O(log n)
// INV: a user has at most one outstanding reset link
// SEC: uid is the account found for the submitted email, never a client-supplied id; only sha256(token) is stored
export async function savePasswordReset(uid: string, tokenHash: Uint8Array, seconds: number): Promise<void> {
  await sql.begin(async (tx) => {
    await tx`DELETE FROM password_resets WHERE user_id = ${uid}`;
    await tx`INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES (${tokenHash}, ${uid}, now() + make_interval(secs => ${seconds}))`;
  });
}

// O(1)
export async function deletePasswordReset(tokenHash: Uint8Array): Promise<void> {
  await sql`DELETE FROM password_resets WHERE token_hash = ${tokenHash}`;
}

// O(1)
export async function passwordResetIsLive(tokenHash: Uint8Array): Promise<boolean> {
  const rows: { ok: boolean }[] = await sql`SELECT true AS ok FROM password_resets WHERE token_hash = ${tokenHash} AND expires_at > now() LIMIT 1`;
  return rows.length > 0;
}

// O(1) on the token hash primary key
// INV: the link works once; the new password, the end of every session, and the end of every reset link commit together
// SEC: the token hash is the credential; the user id comes from that row, never from the client
export async function applyPasswordReset(tokenHash: Uint8Array, pwHash: string): Promise<{ id: string; email: string } | null> {
  return sql.begin(async (tx) => {
    const found: { user_id: string }[] = await tx`
      DELETE FROM password_resets WHERE token_hash = ${tokenHash} AND expires_at > now() RETURNING user_id`;
    const hit = found[0];
    if (!hit) return null;
    const users: { id: string; email: string }[] = await tx`UPDATE users SET pw_hash = ${pwHash} WHERE id = ${hit.user_id} RETURNING id, email`;
    const user = users[0];
    if (!user) return null;
    await tx`DELETE FROM sessions WHERE user_id = ${user.id}`;
    await tx`DELETE FROM password_resets WHERE user_id = ${user.id}`;
    return user;
  });
}

// O(log n + sessions)
// INV: the new hash, the end of every session and reset link, and the replacement session commit together
export async function rotateUserPassword(uid: string, pwHash: string, sessionHash: Uint8Array): Promise<boolean> {
  return sql.begin(async (tx) => {
    const rows: { id: string }[] = await tx`UPDATE users SET pw_hash = ${pwHash} WHERE id = ${uid} RETURNING id`;
    if (!rows[0]) return false;
    await tx`DELETE FROM sessions WHERE user_id = ${uid}`;
    await tx`DELETE FROM password_resets WHERE user_id = ${uid}`;
    await tx`INSERT INTO sessions (id_hash, user_id, expires_at) VALUES (${sessionHash}, ${uid}, now() + make_interval(secs => ${SESSION_SECONDS}))`;
    return true;
  });
}

// O(k) in the account's rows, via ON DELETE CASCADE
// SEC: uid comes from the session
export async function deleteUserAccount(uid: string): Promise<boolean> {
  const rows: { id: string }[] = await sql`DELETE FROM users WHERE id = ${uid} RETURNING id`;
  return rows.length > 0;
}

// O(k) in expired rows, via password_resets_expires_idx
export async function deleteExpiredPasswordResets(): Promise<void> {
  await sql`DELETE FROM password_resets WHERE expires_at < now()`;
}

// O(log n)
// INV: renames the legacy local profile in place, so its lessons, questions and history move with it; fails if the target email is taken
export async function claimLocalProfile(email: string, pwHash: string): Promise<"claimed" | "missing" | "taken"> {
  return sql.begin(async (tx) => {
    const taken: { id: string }[] = await tx`SELECT id FROM users WHERE email = ${email} LIMIT 1`;
    if (taken.length > 0) return "taken";
    const rows: { id: string }[] = await tx`UPDATE users SET email = ${email}, pw_hash = ${pwHash} WHERE email = ${LEGACY_LOCAL_EMAIL} RETURNING id`;
    return rows.length > 0 ? "claimed" : "missing";
  });
}
