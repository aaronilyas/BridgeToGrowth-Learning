import { expect, test } from "bun:test";
import { abstractFromInverted, filterCitations } from "./core.ts";

test("abstractFromInverted places words by index", () => {
  expect(abstractFromInverted({ b: [1], a: [0], c: [2, 4], d: [3] })).toBe("a b c d c");
});

test("filterCitations strips out-of-range citations", () => {
  const r = filterCitations("x [0] y [2] z [7] [2] [5]", 5);
  expect(r.text).not.toContain("[0]");
  expect(r.text).not.toContain("[7]");
  expect(r.used).toEqual([2, 5]);
});
