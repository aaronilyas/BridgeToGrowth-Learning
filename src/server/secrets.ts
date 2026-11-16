import { AsyncLocalStorage } from "node:async_hooks";
import type { ProviderId } from "../shared/providers.ts";

const SERVICE = "BridgeToGrowth Learning";

type SecretBox = {
  get(options: { service: string; name: string }): Promise<string | null>;
  set(options: { service: string; name: string; value: string }): Promise<void>;
  delete(options: { service: string; name: string }): Promise<boolean>;
};

let box: SecretBox = Bun.secrets;
const requestKeys = new AsyncLocalStorage<Map<ProviderId, Promise<string | null>>>();

// O(1)
// SEC: tests substitute a memory box so provider keys never enter the OS keychain or a log
export function useSecretBox(next: SecretBox): void {
  box = next;
}

// O(1) plus fn
// INV: inside fn each provider's key is read from the keychain at most once; a store or delete inside fn replaces what later reads see
// SEC: the remembered keys live only in this call's memory and are dropped with it; they are never logged, persisted or shared with another request
export function withKeyReads<T>(fn: () => T): T {
  return requestKeys.run(new Map(), fn);
}

// O(1)
async function readFromBox(id: ProviderId): Promise<string | null> {
  const value = await box.get({ service: SERVICE, name: id });
  return value === null || value.length === 0 ? null : value;
}

// O(1)
// SEC: the key stays in the OS keychain; callers must not log or persist the return value
// INV: a failed read is not remembered, so the next read in the same request asks the keychain again
export async function readProviderKey(id: ProviderId): Promise<string | null> {
  const memo = requestKeys.getStore();
  if (memo === undefined) return readFromBox(id);
  const known = memo.get(id);
  if (known !== undefined) return known;
  const read = readFromBox(id);
  memo.set(id, read);
  read.catch(() => {
    if (memo.get(id) === read) memo.delete(id);
  });
  return read;
}

// O(1)
// SEC: the key is written only to the OS keychain, never to SQLite, logs, or the response
export async function storeProviderKey(id: ProviderId, key: string): Promise<void> {
  await box.set({ service: SERVICE, name: id, value: key });
  requestKeys.getStore()?.set(id, Promise.resolve(key.length === 0 ? null : key));
}

// O(1)
export async function deleteProviderKey(id: ProviderId): Promise<void> {
  await box.delete({ service: SERVICE, name: id });
  requestKeys.getStore()?.set(id, Promise.resolve(null));
}

// O(1)
// SEC: only the last four characters leave this function, and only when the key is longer than that
export function keyHint(key: string | null): string | null {
  if (key === null || key.length < 8) return null;
  return key.slice(-4);
}
