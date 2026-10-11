import * as SecureStore from 'expo-secure-store';
export interface Storage { get(key: string): Promise<string | null>; set(key: string, value: string): Promise<void>; remove(key: string): Promise<void> }
export const secureStorage: Storage = {
  get: key => SecureStore.getItemAsync(key),
  set: (key, value) => SecureStore.setItemAsync(key, value, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }),
  remove: key => SecureStore.deleteItemAsync(key),
};
// All writes, including session teardown, stay ordered across account changes.
export class OrderedStorage implements Storage {
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private storage: Storage) {}
  private enqueue<T>(action: () => Promise<T>): Promise<T> {
    const next = this.tail.then(action, action); this.tail = next.catch(() => undefined); return next;
  }
  get(key: string) { return this.enqueue(() => this.storage.get(key)); }
  set(key: string, value: string) { return this.enqueue(() => this.storage.set(key, value)); }
  remove(key: string) { return this.enqueue(() => this.storage.remove(key)); }
}
