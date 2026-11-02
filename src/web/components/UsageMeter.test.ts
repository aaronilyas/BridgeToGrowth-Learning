import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { UsageMeter } from "./UsageMeter.tsx";

test("the usage meter shows this month's spend", () => {
  const html = renderToStaticMarkup(createElement(UsageMeter, { spent: 1.5 }));
  expect(html).toContain("Monthly usage");
  expect(html).toContain("$1.50 used");
  expect(html).not.toContain("reserved");
  expect(html).not.toContain("Pro");
  expect(html).not.toContain("Free");
});
