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
// INV: a password change ends every session of that user in the same transaction
export async function setUserPassword(email: string, pwHash: string): Promise<boolean> {
  return sql.begin(async (tx) => {
    const rows: { id: string }[] = await tx`UPDATE users SET pw_hash = ${pwHash} WHERE email = ${email} RETURNING id`;
    const row = rows[0];
    if (!row) return false;
    await tx`DELETE FROM sessions WHERE user_id = ${row.id}`;
    return true;
  });
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
