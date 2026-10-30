import { sql } from "../db.ts";
import { LOCAL_EMAIL, type LocalUser } from "./core.ts";

// O(1)
// INV: one row with LOCAL_EMAIL; concurrent boots collide on the unique email and then read it
export async function ensureLocalUser(): Promise<LocalUser> {
  await sql`
    INSERT INTO users (email, pw_hash, trial_ends_at)
    VALUES (${LOCAL_EMAIL}, 'unused', now() + interval '100 years')
    ON CONFLICT (email) DO NOTHING`;
  const rows: LocalUser[] = await sql`
    SELECT id, email, settings FROM users WHERE email = ${LOCAL_EMAIL} LIMIT 1`;
  const row = rows[0];
  if (!row) throw new Error("local user missing");
  return row;
}
