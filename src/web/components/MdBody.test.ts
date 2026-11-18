import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { normalizeMarkdown } from "../../shared/markdown.ts";
import { wrapBareMath } from "../../shared/math.ts";
import { MdBody } from "./MdBody.tsx";
import { MATH_HAST_CAP, mathHastMisses, resetMathHastCache, storedMathHast } from "./rehypeKatexMemo.ts";

const remarkPlugins: NonNullable<Parameters<typeof ReactMarkdown>[0]["remarkPlugins"]> = [[remarkGfm, { singleTilde: false }], remarkMath];

const components: Components = {
  img: () => null,
  a: ({ href, children }) => {
    let ok = false;
    try {
      ok = typeof href === "string" && ["http:", "https:"].includes(new URL(href).protocol);
    } catch {
      ok = false;
    }
    return ok ? createElement("a", { href, target: "_blank", rel: "noopener noreferrer" }, children) : createElement("span", null, children);
  },
  table: ({ children }) => createElement("div", { className: "md-table" }, createElement("table", null, children)),
};

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

function oldHtml(text: string): string {
  return renderToStaticMarkup(createElement(ReactMarkdown, {
    skipHtml: true,
    remarkPlugins,
    rehypePlugins: [rehypeKatex],
    components,
    children: normalizeMarkdown(wrapBareMath(text)),
  }));
}

function newHtml(text: string): string {
  return renderToStaticMarkup(createElement(MdBody, { text }));
}

test("the memoized math pipeline renders the same HTML as rehype-katex", () => {
  resetMathHastCache();
  const oldOnce = oldHtml(CORPUS);
  const first = newHtml(CORPUS);
  const second = newHtml(CORPUS);
  expect(first).toBe(oldOnce);
  expect(second).toBe(oldOnce);
  expect(first).toContain("katex");
  expect(first).toContain("katex-error");
  expect(first).toContain("katex-display");
  expect(first).toContain("md-table");
  expect(first).toContain("<ol>");
  expect(first).toContain('href="https://example.com"');
  expect(first).not.toContain("<script");
  expect(first).not.toContain("onerror");
  expect(first).not.toContain("javascript:");
  expect(first).not.toContain("<img");
});

test("one TeX string is typeset once per display mode and then reused", () => {
  resetMathHastCache();
  newHtml("Inline $x^2$ and again $x^2$.\n\n$$\nx^2\n$$");
  expect(mathHastMisses()).toBe(2);
  newHtml("Inline $x^2$ and again $x^2$.\n\n$$\nx^2\n$$");
  expect(mathHastMisses()).toBe(2);
  const inline = storedMathHast("x^2", false);
  const display = storedMathHast("x^2", true);
  expect(inline?.[0]?.type).toBe("element");
  expect(display?.[0]?.type).toBe("element");
  if (display?.[0]?.type === "element") expect(display[0].properties.className).toContain("katex-display");
  if (inline?.[0]?.type === "element") expect(inline[0].properties.className).not.toContain("katex-display");
});

test("invalid TeX is cached too, and a cached tree cannot be mutated", () => {
  resetMathHastCache();
  const html = newHtml("Broken $\\frac{$.");
  expect(html).toContain("katex-error");
  expect(mathHastMisses()).toBe(1);
  newHtml("Broken $\\frac{$.");
  expect(mathHastMisses()).toBe(1);
  const stored = storedMathHast("\\frac{", false);
  expect(stored).not.toBeNull();
  const node = stored?.[0];
  expect(node?.type).toBe("element");
  if (node?.type !== "element") throw new Error("expected an element");
  expect(() => { (node.properties.className as string[]).push("tampered"); }).toThrow();
  expect(newHtml("Broken $\\frac{$.").includes("tampered")).toBe(false);
});

test("the math cache drops the least recently used expression past its cap", () => {
  resetMathHastCache();
  expect(MATH_HAST_CAP).toBe(256);
  const tex = (n: number): string => `z_{${n}}`;
  for (let n = 0; n < MATH_HAST_CAP; n++) newHtml(`$${tex(n)}$`);
  expect(mathHastMisses()).toBe(MATH_HAST_CAP);
  newHtml(`$${tex(0)}$`);
  expect(mathHastMisses()).toBe(MATH_HAST_CAP);
  newHtml(`$${tex(MATH_HAST_CAP)}$`);
  expect(mathHastMisses()).toBe(MATH_HAST_CAP + 1);
  expect(storedMathHast(tex(0), false)).not.toBeNull();
  expect(storedMathHast(tex(1), false)).toBeNull();
  newHtml(`$${tex(1)}$`);
  expect(mathHastMisses()).toBe(MATH_HAST_CAP + 2);
  newHtml(`$${tex(MATH_HAST_CAP)}$`);
  expect(mathHastMisses()).toBe(MATH_HAST_CAP + 2);
});

// KaTeX's atom-type tags: it emits them on every atom but never styles them on their own
const KATEX_ATOM_TAGS = new Set(["mord", "mbin", "mrel", "mopen", "mclose", "mpunct", "minner", "mop", "mtight", "text"]);

const MATH_STRESS = [
  "Inline $c_{ij}=a_{ij}b_{ij}$ and $x^{2}_{k}$.",
  "$$c_{ij}=a_{ij}b_{ij}$$",
  "$$\\frac{\\sqrt{x_1^2+x_2^2}}{\\sum_{i=1}^{n} y_i} \\le \\int_0^\\infty e^{-t}\\,dt$$",
  "$$\\begin{pmatrix} a_{11} & a_{12} \\\\ a_{21} & a_{22} \\end{pmatrix} \\overline{z} \\hat{v} \\vec{u} \\binom{n}{k}$$",
  "$$\\lim_{h \\to 0} \\frac{f(x+h)-f(x)}{h} = \\left\\lvert \\nabla f \\right\\rvert \\quad \\text{and } \\mathbb{R}^n$$",
].join("\n\n");

// INV: the stylesheet Md.tsx loads is the one this test reads
function katexCss(): string {
  return readFileSync(Bun.resolveSync("katex/dist/katex.min.css", import.meta.dir), "utf8");
}

test("rehype-katex typesets with the same KaTeX whose stylesheet and fonts the app ships", () => {
  const appKatex = Bun.resolveSync("katex/package.json", import.meta.dir);
  const rendererKatex = Bun.resolveSync("katex/package.json", dirname(Bun.resolveSync("rehype-katex", import.meta.dir)));
  expect(rendererKatex).toBe(appKatex);
});

test("every class the math renderer emits is styled by the shipped KaTeX stylesheet", () => {
  resetMathHastCache();
  const html = newHtml(MATH_STRESS);
  const css = katexCss();
  const classes = new Set([...html.matchAll(/class="([^"]+)"/g)].flatMap((m) => (m[1] ?? "").split(/\s+/)));
  const unstyled = [...classes].filter((c) => c !== "" && !KATEX_ATOM_TAGS.has(c) && !new RegExp(`\\.${c.replace(/[-]/g, "\\-")}(?![\\w-])`).test(css));
  expect(classes.size).toBeGreaterThan(10);
  expect(unstyled).toEqual([]);
});

test("a subscript is typeset smaller than its base and raised off the baseline", () => {
  resetMathHastCache();
  const html = newHtml("$$c_{ij}=a_{ij}b_{ij}$$");
  expect(html).toContain("msupsub");
  const sizing = /class="([^"]*\bsize3\b[^"]*)"/.exec(html)?.[1] ?? "";
  const sizingRule = sizing.split(/\s+/).find((c) => /sizing$/.test(c)) ?? "";
  expect(sizingRule).not.toBe("");
  expect(katexCss()).toMatch(new RegExp(`\\.${sizingRule}\\.reset-size6\\.size3\\{font-size:\\.7em\\}`));
});
