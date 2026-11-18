import { afterEach, expect, test } from "bun:test";
import { gateOf, readKnownConnected } from "./connections.tsx";

// Another test file may have installed localStorage with Object.defineProperty
// (read-only), so plain assignment throws when it runs first. Define instead.
const saved = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
function setStorage(value: Storage): void {
  Object.defineProperty(globalThis, "localStorage", { value, configurable: true, writable: true });
}
afterEach(() => {
  if (saved) Object.defineProperty(globalThis, "localStorage", saved);
  else delete (globalThis as { localStorage?: Storage }).localStorage;
});

// O(1)
function storage(values: Record<string, string>, throws = false): Storage {
  return { getItem: (k: string) => { if (throws) throw new Error("denied"); return values[k] ?? null; } } as Storage;
}

test("an answered check decides the gate whatever this device saw before", () => {
  expect(gateOf({ answered: true, connected: true, failed: false, known: false })).toBe("app");
  expect(gateOf({ answered: true, connected: false, failed: false, known: true })).toBe("first-run");
});

test("before an answer, a device that was connected opens the app at once, and a new device waits", () => {
  expect(gateOf({ answered: false, connected: false, failed: false, known: true })).toBe("app");
  expect(gateOf({ answered: false, connected: false, failed: false, known: false })).toBe("loading");
});

test("a failed check keeps a known-connected device in the app and shows first run otherwise, as before", () => {
  expect(gateOf({ answered: false, connected: false, failed: true, known: true })).toBe("app");
  expect(gateOf({ answered: false, connected: false, failed: true, known: false })).toBe("first-run");
});

test("only a stored 1 counts as known-connected; missing, other values and storage errors do not", () => {
  setStorage(storage({ "btg:connected": "1" }));
  expect(readKnownConnected()).toBe(true);
  setStorage(storage({ "btg:connected": "0" }));
  expect(readKnownConnected()).toBe(false);
  setStorage(storage({}));
  expect(readKnownConnected()).toBe(false);
  setStorage(storage({ "btg:connected": "1" }, true));
  expect(readKnownConnected()).toBe(false);
});
