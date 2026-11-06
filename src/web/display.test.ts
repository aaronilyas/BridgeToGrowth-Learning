import { expect, test } from "bun:test";
import { calibrate, MAX_SCALE, MIN_SCALE } from "./display.ts";

const full = (w: number, h: number) => ({ screenWidth: w, screenHeight: h, viewportWidth: w, viewportHeight: h });

test("the reference display keeps the design size", () => {
  expect(calibrate(full(1440, 900)).scale).toBe(1);
});

test("larger effective resolutions grow the UI, sub-linearly and in 5% steps", () => {
  const hd = calibrate(full(1920, 1054)).scale;
  const qhd = calibrate(full(2560, 1400)).scale;
  const uhd = calibrate(full(3840, 2120)).scale;
  expect(hd).toBe(1.1);
  expect(qhd).toBeGreaterThan(hd);
  expect(uhd).toBeGreaterThan(qhd);
  expect(uhd).toBeLessThan(3840 / 1440); // not linear
  for (const s of [hd, qhd, uhd]) expect(Math.round(s * 100) % 5).toBe(0);
});

test("small screens shrink the UI but not below the floor", () => {
  expect(calibrate(full(1366, 728)).scale).toBeLessThan(1);
  expect(calibrate(full(800, 500)).scale).toBe(MIN_SCALE);
});

test("a small window on a big monitor caps the scale so the layout still fits", () => {
  const big = { screenWidth: 3840, screenHeight: 2120 };
  const wide = calibrate({ ...big, viewportWidth: 3840, viewportHeight: 2120 });
  const halfTiled = calibrate({ ...big, viewportWidth: 1000, viewportHeight: 2120 });
  expect(halfTiled.scale).toBeLessThan(wide.scale);
  expect(64 * 13 * halfTiled.scale).toBeLessThanOrEqual(1000);
});

test("the scale never exceeds the ceiling and bad input falls back to 1", () => {
  expect(calibrate(full(15360, 8640)).scale).toBe(MAX_SCALE);
  expect(calibrate(full(0, 0)).scale).toBe(1);
  expect(calibrate({ screenWidth: Number.NaN, screenHeight: 900, viewportWidth: 1, viewportHeight: 1 }).scale).toBe(1);
});
