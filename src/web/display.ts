// Auto-calibrates the UI scale to the user's monitor. Pure maths here; zoom.ts applies the result.
//
// The UI is sized in rem and designed at 13px per rem on a 1440×900 (CSS px) screen. A screen with more CSS pixels is
// either physically larger or denser without OS scaling (a 4K panel at 100%), so the UI grows with it, but sub-linearly:
// a larger monitor should show somewhat more content, not just the same content blown up.

export type DisplayInput = {
  screenWidth: number; // monitor work area in CSS px (screen.availWidth)
  screenHeight: number;
  viewportWidth: number; // the window's inner size in CSS px
  viewportHeight: number;
};

export type Calibration = { scale: number; byScreen: number; byWindow: number };

export const REFERENCE_SCREEN = { width: 1440, height: 900 } as const;
const GROWTH = 0.6; // < 1: grow slower than the screen does
export const MIN_SCALE = 0.85;
export const MAX_SCALE = 2;
const STEP = 0.05;
// The window must fit the sidebar (18rem) beside the lesson column (46rem), and a lesson's header, a few lines of
// transcript and the composer (about 44rem tall), at the 13px design size.
export const LAYOUT_MIN_REM = { width: 64, height: 44 } as const;
const DESIGN_PX_PER_REM = 13;

// O(1)
function finitePositive(n: number): boolean {
  return Number.isFinite(n) && n > 0;
}

// O(1)
// INV: result is a multiple of STEP within [MIN_SCALE, MAX_SCALE]; bad input yields 1
// INV: never scales the UI so large that the minimum layout overflows the window (unless MIN_SCALE already does)
export function calibrate(input: DisplayInput): Calibration {
  const { screenWidth, screenHeight, viewportWidth, viewportHeight } = input;
  if (![screenWidth, screenHeight].every(finitePositive)) return { scale: 1, byScreen: 1, byWindow: 1 };
  const ratio = Math.min(screenWidth / REFERENCE_SCREEN.width, screenHeight / REFERENCE_SCREEN.height);
  const byScreen = ratio ** GROWTH;
  const byWindow = [viewportWidth, viewportHeight].every(finitePositive)
    ? Math.min(viewportWidth / (LAYOUT_MIN_REM.width * DESIGN_PX_PER_REM), viewportHeight / (LAYOUT_MIN_REM.height * DESIGN_PX_PER_REM))
    : Number.POSITIVE_INFINITY;
  const raw = Math.min(byScreen, byWindow);
  // Round the screen-driven value to the nearest step, but floor when the window is the limit so the layout still fits.
  const stepped = byWindow < byScreen ? Math.floor(raw / STEP) * STEP : Math.round(raw / STEP) * STEP;
  const scale = Math.round(Math.min(MAX_SCALE, Math.max(MIN_SCALE, stepped)) * 100) / 100;
  return { scale, byScreen, byWindow };
}

// O(1)
export function readDisplay(): DisplayInput {
  return {
    screenWidth: window.screen?.availWidth || window.screen?.width || 0,
    screenHeight: window.screen?.availHeight || window.screen?.height || 0,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
  };
}
