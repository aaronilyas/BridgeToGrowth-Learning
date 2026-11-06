import { useEffect, useState } from "react";
import { calibrate, LAYOUT_MIN_REM, readDisplay, type Calibration, type DisplayInput } from "./display.ts";

const KEY = "btg:zoom";
const AUTO_KEY = "btg:auto-fit";
// The root font size at 100% zoom on the reference display, as a share of the browser default (16px). The UI is sized in rem, so this scales the whole app.
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
// INV: auto-fit is on unless the user turned it off on this device
export function readAutoFit(): boolean {
  try {
    return localStorage.getItem(AUTO_KEY) !== "0";
  } catch {
    return true;
  }
}

export type DisplayState = {
  autoFit: boolean;
  zoom: number; // the user's zoom, relative to the calibrated size
  calibration: Calibration;
  display: DisplayInput;
  rootPx: number; // the applied size of 1rem
  narrow: boolean; // the window cannot hold the sidebar beside the lesson column
};

let current: DisplayState | null = null;

// O(1)
function compute(): DisplayState {
  const display = readDisplay();
  const calibration = calibrate(display);
  const autoFit = readAutoFit();
  const zoom = readZoom();
  const rootPx = (16 * BASE_ROOT_PERCENT * (autoFit ? calibration.scale : 1) * zoom) / 100;
  return { autoFit, zoom, calibration, display, rootPx, narrow: display.viewportWidth < LAYOUT_MIN_REM.width * rootPx };
}

// O(1)
// INV: the root font size is the design size × the monitor calibration (when auto-fit is on) × the user's zoom
function apply(): void {
  const next = compute();
  const changed =
    current === null ||
    next.rootPx !== current.rootPx ||
    next.narrow !== current.narrow ||
    next.autoFit !== current.autoFit ||
    next.zoom !== current.zoom ||
    next.display.screenWidth !== current.display.screenWidth ||
    next.display.screenHeight !== current.display.screenHeight;
  current = next;
  document.documentElement.style.fontSize = `${(next.rootPx / 16) * 100}%`;
  if (changed) window.dispatchEvent(new CustomEvent(EVENT));
}

// O(1)
export function setZoom(zoom: number): void {
  try {
    localStorage.setItem(KEY, String(snapZoom(zoom)));
  } catch {
    // storage unavailable: the zoom still applies for this session
  }
  apply();
}

// O(1)
export function setAutoFit(on: boolean): void {
  try {
    localStorage.setItem(AUTO_KEY, on ? "1" : "0");
  } catch {
    // storage unavailable
  }
  apply();
}

// O(1)
// INV: Ctrl/Cmd with +/=, - and 0 zoom in, out and reset, like a browser
// INV: the calibration re-runs when the window resizes or moves to a monitor with a different pixel density
export function installZoom(): void {
  apply();
  window.addEventListener("keydown", (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    if (e.key === "=" || e.key === "+") setZoom(stepZoom(readZoom(), 1));
    else if (e.key === "-" || e.key === "_") setZoom(stepZoom(readZoom(), -1));
    else if (e.key === "0") setZoom(1);
    else return;
    e.preventDefault();
  });
  let frame = 0;
  const schedule = (): void => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(apply);
  };
  window.addEventListener("resize", schedule);
  window.addEventListener("focus", schedule); // a window dragged to another monitor may not resize
  const watchDensity = (): void => {
    const query = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    query.addEventListener(
      "change",
      () => {
        schedule();
        watchDensity();
      },
      { once: true },
    );
  };
  watchDensity();
}

// O(1)
export function readDisplayState(): DisplayState {
  return current ?? compute();
}

// O(1)
export function useDisplayState(): DisplayState {
  const [state, set] = useState(readDisplayState);
  useEffect(() => {
    const sync = (): void => set(readDisplayState());
    window.addEventListener(EVENT, sync);
    return () => window.removeEventListener(EVENT, sync);
  }, []);
  return state;
}

// O(1)
export function useZoom(): number {
  return useDisplayState().zoom;
}
