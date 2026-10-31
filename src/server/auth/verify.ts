const DUMMY_HASH = await Bun.password.hash("dummy-password-for-timing-parity", "argon2id");

// O(1) plus one argon2id verify
// SEC: a null hash verifies against a fixed dummy; a malformed hash (for example the retired local profile's placeholder) is a failed check, not a 500
export async function verifyPassword(password: string, hash: string | null): Promise<boolean> {
  try {
    return await Bun.password.verify(password, hash ?? DUMMY_HASH);
  } catch {
    return false;
  }
}
