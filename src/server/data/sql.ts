import type { SQL } from "bun";
import { LOCAL_EMAIL, LOCAL_USER_ID } from "../profile.ts";

// O(tables)
// INV: app rows go away and the seeded local profile comes back; the migration ledger stays
export async function deleteAppRows(tx: SQL): Promise<void> {
  await tx`DELETE FROM messages`;
  await tx`DELETE FROM conversations`;
  await tx`DELETE FROM attempts`;
  await tx`DELETE FROM cards`;
  await tx`DELETE FROM questions`;
  await tx`DELETE FROM lessons`;
  await tx`DELETE FROM topic_edges`;
  await tx`DELETE FROM topics`;
  await tx`DELETE FROM styles`;
  await tx`DELETE FROM daily_activity`;
  await tx`DELETE FROM insights`;
  await tx`DELETE FROM llm_usage`;
  await tx`DELETE FROM provider_models`;
  await tx`DELETE FROM papers`;
  await tx`DELETE FROM retrieval_cache`;
  await tx`DELETE FROM users`;
  await tx`INSERT INTO users (id, email, settings, created_at) VALUES (${LOCAL_USER_ID}, ${LOCAL_EMAIL}, '{}', 0)`;
}
