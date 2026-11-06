import { useEffect, useState } from "react";

const KEY = "btg:zoom";
// The root font size at 100% zoom, as a share of the browser default (16px). The UI is sized in rem, so this scales the whole app.
export const BASE_ROOT_PERCENT = 81.25;
export const ZOOM_LEVELS = [0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2] as const;
const EVENT = "btg:zoom-changed";

// O(n) in levels
// INV: any stored value is snapped to the nearest known level; missing or bad values fall back to 1
export function snapZoom(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return ZOOM_LEVELS.reduce((best, z) => (Math.abs(z - value) < Math.abs(best - value) ? z : best), 1);
}

// O(n) in levels
// INV: stepping past either end stays on the end level
export function stepZoom(current: number, dir: 1 | -1): number {
  const i = ZOOM_LEVELS.indexOf(snapZoom(current) as (typeof ZOOM_LEVELS)[number]);
  return ZOOM_LEVELS[Math.min(ZOOM_LEVELS.length - 1, Math.max(0, i + dir))] ?? 1;
}

// O(1)
export function readZoom(): number {
  try {
    const raw = localStorage.getItem(KEY);
    return raw === null ? 1 : snapZoom(Number(raw));
  } catch {
    return 1;
  }
}

// O(1)
function apply(zoom: number): void {
  document.documentElement.style.fontSize = `${BASE_ROOT_PERCENT * zoom}%`;
}

// O(1)
export function setZoom(zoom: number): void {
  const next = snapZoom(zoom);
  apply(next);
  try {
    localStorage.setItem(KEY, String(next));
  } catch {
    // storage unavailable: the zoom still applies for this session
  }
  window.dispatchEvent(new CustomEvent(EVENT));
}

// O(1)
// INV: Ctrl/Cmd with +/=, - and 0 zoom in, out and reset, like a browser
export function installZoom(): void {
  apply(readZoom());
  window.addEventListener("keydown", (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    if (e.key === "=" || e.key === "+") setZoom(stepZoom(readZoom(), 1));
    else if (e.key === "-" || e.key === "_") setZoom(stepZoom(readZoom(), -1));
    else if (e.key === "0") setZoom(1);
    else return;
    e.preventDefault();
  });
}

// O(1)
export function useZoom(): number {
  const [zoom, set] = useState(readZoom);
  useEffect(() => {
    const sync = (): void => set(readZoom());
    window.addEventListener(EVENT, sync);
    return () => window.removeEventListener(EVENT, sync);
  }, []);
  return zoom;
}
