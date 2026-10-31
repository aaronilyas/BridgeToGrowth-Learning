import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { UsageMeter, usagePercent } from "./UsageMeter.tsx";

test("usagePercent covers both plan caps, including reserved and a zero cap", () => {
  expect(usagePercent(0, 0, 200_000)).toBe(0);
  expect(usagePercent(50_000, 0, 200_000)).toBe(25);
  expect(usagePercent(80_000, 10_000, 100_000)).toBe(90);
  expect(usagePercent(100_000, 20_000, 100_000)).toBe(120);
  expect(usagePercent(0, 0, 0)).toBe(0);
  expect(usagePercent(1, 0, 0)).toBe(100);
});

test("the usage bar attaches a percent for the free plan and the pro plan", () => {
  const free = renderToStaticMarkup(createElement(UsageMeter, { usedMicros: 50_000, reservedMicros: 0, capMicros: 200_000, plan: "free" }));
  const pro = renderToStaticMarkup(createElement(UsageMeter, { usedMicros: 1_198_000, reservedMicros: 0, capMicros: 5_990_000, plan: "pro" }));
  expect(free).toContain("Monthly usage · Free");
  expect(free).toContain(">25%</");
  expect(free).toContain('aria-valuetext="25%"');
  expect(pro).toContain("Monthly usage · Pro");
  expect(pro).toContain(">20%</");
  expect(pro).toContain('aria-valuetext="20%"');
});
