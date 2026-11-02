export const LOCAL_USER_ID = "00000000-0000-4000-8000-000000000001";
export const LOCAL_EMAIL = "local@localhost";

export type LocalProfile = { id: string; settings: Record<string, unknown> };

// O(1)
// INV: one implicit local profile; surviving user_id columns store this id
export async function localProfile(): Promise<LocalProfile> {
  const { findUserSettings } = await import("./learn/sql.ts");
  return { id: LOCAL_USER_ID, settings: await findUserSettings(LOCAL_USER_ID) };
}
