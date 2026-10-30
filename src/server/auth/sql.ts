import { sql } from "../db.ts";
import { MAX_SESSIONS, SESSION_SECONDS, type AuthUser } from "./core.ts";

export type UserCreds = { id: string; email: string; pw_hash: string };

// O(log n)
// INV: ON CONFLICT makes concurrent duplicate signups race-safe
export async function insertUser(email: string, pwHash: string, trialDays: number): Promise<{ id: string; email: string } | null> {
  const rows: { id: string; email: string }[] = await sql`
    INSERT INTO users (email, pw_hash, trial_ends_at)
    VALUES (${email}, ${pwHash}, now() + make_interval(days => ${trialDays}::int))
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
    SELECT u.id, u.email, u.settings, u.trial_ends_at, u.sub_status, u.sub_period_end, u.sub_cancel_at_period_end
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.id_hash = ${idHash} AND s.expires_at > now()`;
  return rows[0] ?? null;
}

// O(log n)
export async function deleteSession(uid: string, idHash: Uint8Array): Promise<void> {
  await sql`DELETE FROM sessions WHERE id_hash = ${idHash} AND user_id = ${uid}`;
}

// O(k) in expired rows
export async function deleteExpiredSessions(): Promise<void> {
  await sql`DELETE FROM sessions WHERE expires_at < now()`;
}
