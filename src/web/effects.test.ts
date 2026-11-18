import { afterEach, expect, test } from "bun:test";
import { artAttribute, readReduceEffects, setReduceEffects } from "./effects.ts";

const KEY = "btg:reduce-effects";
const store = new Map<string, string>();

const localStorageMock = {
  // O(1)
  getItem(key: string): string | null {
    return store.has(key) ? (store.get(key) ?? null) : null;
  },
  // O(1)
  setItem(key: string, value: string): void {
    store.set(key, String(value));
  },
  // O(1)
  removeItem(key: string): void {
    store.delete(key);
  },
};

Object.defineProperty(globalThis, "localStorage", { value: localStorageMock, configurable: true });

afterEach(() => {
  store.delete(KEY);
});

test("readReduceEffects is off when the key is missing or not 1", () => {
  localStorageMock.removeItem(KEY);
  expect(readReduceEffects()).toBe(false);
  localStorageMock.setItem(KEY, "0");
  expect(readReduceEffects()).toBe(false);
  localStorageMock.setItem(KEY, "yes");
  expect(readReduceEffects()).toBe(false);
  localStorageMock.setItem(KEY, "");
  expect(readReduceEffects()).toBe(false);
  localStorageMock.setItem(KEY, "2");
  expect(readReduceEffects()).toBe(false);
  localStorageMock.setItem(KEY, "1");
  expect(readReduceEffects()).toBe(true);
});

test("setReduceEffects writes 1 or 0 and readReduceEffects follows", () => {
  setReduceEffects(true);
  expect(localStorageMock.getItem(KEY)).toBe("1");
  expect(readReduceEffects()).toBe(true);
  setReduceEffects(false);
  expect(localStorageMock.getItem(KEY)).toBe("0");
  expect(readReduceEffects()).toBe(false);
});

test("artAttribute pauses when hidden or unfocused and turns off when reducing effects", () => {
  expect(artAttribute(false, true, false)).toBe(null);
  expect(artAttribute(true, true, false)).toBe("paused");
  expect(artAttribute(false, false, false)).toBe("paused");
  expect(artAttribute(true, false, false)).toBe("paused");
  expect(artAttribute(false, true, true)).toBe("off");
  expect(artAttribute(true, true, true)).toBe("off");
  expect(artAttribute(false, false, true)).toBe("off");
});
