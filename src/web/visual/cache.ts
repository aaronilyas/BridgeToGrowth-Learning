import { useEffect, useReducer } from "react";

const MAX_ENTRIES = 64;

export type VisualCache<T> = { peek: (source: string) => T | undefined; load: (source: string, run: (source: string) => Promise<T>) => Promise<T> };

// O(n) in source length
// INV: cyrb53, a 53-bit non-cryptographic hash; the cache key, never a security boundary
export function hashSource(source: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < source.length; i++) {
    const c = source.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

// O(1)
// INV: one run per source hash for the page's lifetime, the oldest of MAX_ENTRIES dropped first; a failure is a result too, so neither a re-render nor an older message runs the source again
export function createVisualCache<T>(): VisualCache<T> {
  const runs = new Map<string, { promise: Promise<T>; value: T | undefined }>();
  return {
    peek: (source) => runs.get(hashSource(source))?.value,
    load: (source, run) => {
      const key = hashSource(source);
      const have = runs.get(key);
      if (have) return have.promise;
      const entry: { promise: Promise<T>; value: T | undefined } = { promise: run(source), value: undefined };
      entry.promise = entry.promise.then((v) => {
        entry.value = v;
        return v;
      });
      runs.set(key, entry);
      if (runs.size > MAX_ENTRIES) runs.delete(runs.keys().next().value ?? key);
      return entry.promise;
    },
  };
}

// O(1) per render
// INV: run must resolve, never reject; it starts in an effect, never during render
export function useVisualResult<T>(cache: VisualCache<T>, source: string, run: (source: string) => Promise<T>): T | undefined {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const value = cache.peek(source);
  useEffect(() => {
    if (value !== undefined) return;
    let live = true;
    void cache.load(source, run).then(() => {
      if (live) bump();
    });
    return () => {
      live = false;
    };
  }, [cache, source, run, value]);
  return value;
}

// O(n) in SVG length
// SEC: an SVG shown through <img> is a static image: its scripts, handlers and links never run
export function svgDataUri(svg: string): string {
  const bytes = new TextEncoder().encode(svg);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:image/svg+xml;base64,${btoa(bin)}`;
}

// O(n) in message length
// INV: one line of at most 160 characters, for the error row under a failed visual
export function oneLine(message: string): string {
  const line = message.split("\n").map((l) => l.trim()).find((l) => l !== "") ?? "The visual failed.";
  return line.length > 160 ? `${line.slice(0, 159)}…` : line;
}
