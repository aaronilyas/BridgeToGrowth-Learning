import { expect, test } from "bun:test";
import { snapZoom, stepZoom, ZOOM_LEVELS } from "./zoom.ts";

test("snapZoom picks the nearest level and defaults bad input to 1", () => {
  expect(snapZoom(1.12)).toBe(1.1);
  expect(snapZoom(5)).toBe(2);
  expect(snapZoom(Number.NaN)).toBe(1);
});

test("stepZoom moves one level and clamps at the ends", () => {
  expect(stepZoom(1, 1)).toBe(1.1);
  expect(stepZoom(1, -1)).toBe(0.9);
  expect(stepZoom(ZOOM_LEVELS[0], -1)).toBe(ZOOM_LEVELS[0]);
  expect(stepZoom(2, 1)).toBe(2);
});
