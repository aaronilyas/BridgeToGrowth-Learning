import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MdBody } from "../web/components/MdBody.tsx";
import { normalizeMarkdown } from "./markdown.ts";

const html = (text: string): string => renderToStaticMarkup(createElement(MdBody, { text }));

// The step that showed its truth table as one run-on paragraph: no table support, and the word cut chopped the last row.
const INTRO = "By the end of this lesson, you will be able to prove that two propositions are logically equivalent. This step starts with the four basic connectives.\n\nA **proposition** is a declarative sentence that is either true (T) or false (F), but not both. \"7 is prime\" is a proposition. \"Close the door\" is not, because it has no truth value. \"$x+1=5$\" is not either, because its truth depends on $x$ until $x$ gets a value.\n\nAn **atomic proposition** is a proposition that contains no connective. A **connective** joins or modifies propositions to build a **compound proposition**. To split a compound proposition, find each connective and the atomic propositions it acts on.";
const TABLE = "| $p$ | $q$ | $\\neg p$ | $p \\wedge q$ | $p \\vee q$ | $p \\oplus q$ |\n|---|---|---|---|---|---|\n| T | T | F | T | T | F |\n| T | F | F | F | T | T |\n| F | T | T | F | T | T |\n| F | F | T | F | F | F |";
const QUESTION = "Which connective is true when exactly one part is true?";
const STEP = `${INTRO}\n\n${TABLE}\n\n${QUESTION}`;

test("a GitHub table renders as a table with math in its cells", () => {
  const out = html(STEP);
  expect(out).toContain("<table>");
  expect(out.match(/<tr>/g)?.length).toBe(5);
  expect(out).toContain("katex");
  expect(out).not.toContain("|---|");
});

test("table rows run together onto one line are split back into rows", () => {
  const run = "| $p$ | $q$ | $p \\wedge q$ | |---|---|---| | T | T | T | | T | F | F |";
  expect(normalizeMarkdown(run)).toBe("| $p$ | $q$ | $p \\wedge q$ |\n|---|---|---|\n| T | T | T |\n| T | F | F |");
  expect(html(run).match(/<tr>/g)?.length).toBe(3);
  const withEmpty = "| a | | b | |---|---|---| | 1 | | 2 |";
  expect(normalizeMarkdown(withEmpty)).toBe("| a | | b |\n|---|---|---|\n| 1 | | 2 |");
});

test("a table gets blank lines around it so prose neither swallows it nor becomes a row", () => {
  expect(normalizeMarkdown("Look:\n| a | b |\n|---|---|\n| 1 | 2 |\nThen this.")).toBe("Look:\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\nThen this.");
  const out = html("Look:\n| a | b |\n|---|---|\n| 1 | 2 |\nThen this.");
  expect(out.match(/<tr>/g)?.length).toBe(2);
  expect(out).toContain("<p>Then this.</p>");
});

test("a | inside math in a table cell does not split the cell", () => {
  expect(normalizeMarkdown("| x | abs |\n|---|---|\n| -2 | $|x| = 2$ |")).toBe("| x | abs |\n|---|---|\n| -2 | $\\vert{}x\\vert{} = 2$ |");
  expect(html("| x | abs |\n|---|---|\n| -2 | $|x| = 2$ |").match(/<td/g)?.length).toBe(2);
  expect(normalizeMarkdown("| a | b |\n|---|---|\n| $5 | $10 |")).toBe("| a | b |\n|---|---|\n| $5 | $10 |");
});

test("text without a table, and fenced code, are unchanged", () => {
  const prose = "The value $|x|$ is never negative.\n\n|x| = 3 means x is 3 or -3.\n\n1. One\n2. Two";
  expect(normalizeMarkdown(prose)).toBe(prose);
  const code = "```\n| a | | b | |---|---|---| | 1 | | 2 |\n```";
  expect(normalizeMarkdown(code)).toBe(code);
  const once = normalizeMarkdown(`${STEP}\nTrailing line.`);
  expect(normalizeMarkdown(once)).toBe(once);
});

test("a single tilde stays literal and links stay safe", () => {
  const out = html("About ~5 to ~10 items, see https://example.com and [x](javascript:alert(1)).");
  expect(out).not.toContain("<del>");
  expect(out).toContain('href="https://example.com"');
  expect(out).not.toContain("javascript:");
});
