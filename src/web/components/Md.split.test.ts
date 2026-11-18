import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { splitMarkdownBlocks } from "../../shared/markdown.ts";
import { tutorReply } from "../../../scripts/bench/fixtures.ts";
import { MdBody } from "./MdBody.tsx";

const CORPUS = [
  "Inline $x^2$ sits beside a display:\n\n$$\nx^2\n$$",
  "Repeated $x^2$ and $x^2$ again.",
  "Broken $\\frac{$.",
  "Bare dy/dx = e^{x} + e^{y} in a sentence.",
  "1. A list item with $y = x$\n2. Next",
  "| $p$ | value |\n|---|---|\n| $x^2$ | 1 |",
  "```math\nx^2\n```",
  "A link [docs](https://example.com) and a bad [x](javascript:alert(1)).",
  "Raw <script>alert(1)</script> and <img src=x onerror=alert(1)> stay out of the DOM.",
].join("\n\n");

const EXTRA = [
  "Para 1\n\nPara 2\n\nPara 3",
  "- a\n\n- b\n\nAfter the list.",
  "1. first\n\n2. second\n\nA following paragraph.",
  "1. foo\nbar still in the item\n\nAfter.",
  "> quoted a\n\n> quoted b\n\nAfter the quote.",
  "A paragraph.\n\n    indented code\n    still code\n\nAfter.",
  "See [foo] and [bar].\n\n[foo]: https://example.com\n[bar]: https://example.org",
  "Call out[^1] here.\n\n[^1]: a footnote from remark-gfm",
  "Setext heading\n==============\n\nThe next paragraph.",
  "A paragraph.\n\n---\n\nAfter the break.",
  "# ATX\n\nBody paragraph.",
  "- outer\n\n  - nested\n\nAfter.",
  "> quote\n>\n> still\n\nAfter.",
  "Look:\n| a | b |\n|---|---|\n| 1 | 2 |\nThen this.",
  "Before\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\nAfter",
  "Prose\n\n```\n| a | b |\n```\n\nMore prose",
  "Prose\n\n$$\n\\int_0^1 x^2 \\, dx\n$$\n\nMore",
  "Prose\n\n\\[\nx^2\n\\]\n\nMore",
  "Bare dy/dx = e^{x} in a sentence.\n\nThen another sentence with $x^2$.",
  "1. **Step one**\n\n   Explanation indented under the item.\n\n2. **Step two**\n\n   More detail.",
  "- item\n\n  continued paragraph in the item\n\nAfter.",
  "1. item\n\n   ```python\n   x = 1\n   ```\n\n2. next",
  "1. item\n\n   $$\n   x^2\n   $$\n\nAfter.",
  "Steps:\n1. a\n2. b\n\n3. c",
  "Intro:\n- a\n- b\n\n- c\n\nAfter.",
  "- a\n\n    code-ish under the item\n\n- b",
  "1) paren list\n\n2) second",
  CORPUS,
  tutorReply(1200),
];

// O(n) in text length
function wholeHtml(text: string): string {
  return renderToStaticMarkup(createElement(MdBody, { text }));
}

// O(n) in text length
function splitHtml(text: string): string {
  return splitMarkdownBlocks(text).map((block) => renderToStaticMarkup(createElement(MdBody, { text: block }))).join("\n");
}

test("block-split MdBody HTML equals whole-text MdBody HTML", () => {
  for (const text of EXTRA) {
    expect(splitHtml(text), text.slice(0, 80)).toBe(wholeHtml(text));
    expect(splitMarkdownBlocks(text).join("")).toBe(text);
  }
  const stream = tutorReply(600);
  for (let n = 1; n <= stream.length; n += 17) {
    const prefix = stream.slice(0, n);
    expect(splitHtml(prefix), `prefix ${n}`).toBe(wholeHtml(prefix));
  }
});

test("every prefix of list-heavy replies splits to the same HTML as the whole prefix", () => {
  const replies = [
    "Steps:\n1. **Set up** the integral $\\int_0^1 x\\,dx$.\n\n   Write the bounds first.\n\n2. **Evaluate**\n\n   - nested point\n   - another\n\n3. Done.\n\nNow a closing paragraph.",
    "- a\n\n  ```python\n  print(1)\n  ```\n\n- b\n\n> quote\n\n> more\n\nEnd.",
  ];
  for (const reply of replies) {
    for (let n = 1; n <= reply.length; n++) {
      const prefix = reply.slice(0, n);
      expect(splitHtml(prefix), JSON.stringify(prefix)).toBe(wholeHtml(prefix));
    }
  }
});
