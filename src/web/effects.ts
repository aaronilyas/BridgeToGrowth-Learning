import { useEffect, useState } from "react";

const KEY = "btg:reduce-effects";
const EVENT = "btg:effects-changed";

export type ArtAttribute = "off" | "paused";

// O(1)
// INV: missing or any value other than "1" means the season-art animations stay on
export function readReduceEffects(): boolean {
  try {
    return globalThis.localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

// O(1)
// INV: reduce-effects wins over pause so the groups sit at identity (rest) rather than a frozen mid-sway pose
// INV: a hidden document is paused even if it still has focus
export function artAttribute(hidden: boolean, focused: boolean, reduceEffects: boolean): ArtAttribute | null {
  if (reduceEffects) return "off";
  if (hidden || !focused) return "paused";
  return null;
}

// O(1)
function applyArtAttribute(): void {
  const doc = globalThis.document;
  const html = doc?.documentElement;
  if (!html) return;
  const focused = typeof doc.hasFocus === "function" ? doc.hasFocus() : true;
  const next = artAttribute(Boolean(doc.hidden), focused, readReduceEffects());
  if (next === null) html.removeAttribute("data-art");
  else html.setAttribute("data-art", next);
}

// O(1)
export function setReduceEffects(on: boolean): void {
  try {
    globalThis.localStorage.setItem(KEY, on ? "1" : "0");
  } catch {
    // storage unavailable
  }
  applyArtAttribute();
  globalThis.window?.dispatchEvent?.(new CustomEvent(EVENT));
}

let installed = false;

// O(1)
// INV: listeners are installed once; visibilitychange, blur and focus all recompute the same attribute
export function installArtEffects(): void {
  if (installed || typeof document === "undefined" || typeof window === "undefined") return;
  installed = true;
  applyArtAttribute();
  document.addEventListener("visibilitychange", applyArtAttribute);
  window.addEventListener("blur", applyArtAttribute);
  window.addEventListener("focus", applyArtAttribute);
}

// O(1)
export function useReduceEffects(): boolean {
  const [on, set] = useState(readReduceEffects);
  useEffect(() => {
    const sync = (): void => set(readReduceEffects());
    window.addEventListener(EVENT, sync);
    return () => window.removeEventListener(EVENT, sync);
  }, []);
  return on;
}
