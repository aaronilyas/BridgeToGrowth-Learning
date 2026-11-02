import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { UsageMeter } from "./UsageMeter.tsx";

test("the usage meter shows spent and reserved dollars", () => {
  const html = renderToStaticMarkup(createElement(UsageMeter, { usedMicros: 1_500_000, reservedMicros: 250_000 }));
  expect(html).toContain("Monthly usage");
  expect(html).toContain("$1.50 used");
  expect(html).toContain("$0.25 reserved");
  expect(html).not.toContain("Pro");
  expect(html).not.toContain("Free");
});
