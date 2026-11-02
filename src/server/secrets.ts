import type { ProviderId } from "../shared/providers.ts";

const SERVICE = "BridgeToGrowth Learning";

type SecretBox = {
  get(options: { service: string; name: string }): Promise<string | null>;
  set(options: { service: string; name: string; value: string }): Promise<void>;
  delete(options: { service: string; name: string }): Promise<boolean>;
};

let box: SecretBox = Bun.secrets;

// O(1)
// SEC: tests substitute a memory box so provider keys never enter the OS keychain or a log
export function useSecretBox(next: SecretBox): void {
  box = next;
}

// O(1)
// SEC: the key stays in the OS keychain; callers must not log or persist the return value
export async function readProviderKey(id: ProviderId): Promise<string | null> {
  const value = await box.get({ service: SERVICE, name: id });
  return value === null || value.length === 0 ? null : value;
}

// O(1)
// SEC: the key is written only to the OS keychain, never to SQLite, logs, or the response
export async function storeProviderKey(id: ProviderId, key: string): Promise<void> {
  await box.set({ service: SERVICE, name: id, value: key });
}

// O(1)
export async function deleteProviderKey(id: ProviderId): Promise<void> {
  await box.delete({ service: SERVICE, name: id });
}

// O(1)
// SEC: only the last four characters leave this function, and only when the key is longer than that
export function keyHint(key: string | null): string | null {
  if (key === null || key.length < 8) return null;
  return key.slice(-4);
}
