import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkMath from "remark-math";
import { wrapBareMath } from "./math.ts";

const EXPL = "An **ordinary differential equation (ODE)** relates an unknown function $y(x)$ to its derivatives. The simplest first\u2011order ODEs have the form $$dy/dx = f(x, y).$$ A **separable ODE** is one where the right\u2011hand side factors into a product of a function of $x$ and a function of $y$: $$dy/dx = g(x) h(y).$$ The **separation principle** allows us to rewrite the equation as $$(1/h(y)) dy = g(x) dx,$$ provided $h(y) \u2260 0$. Both sides can then be integrated independently: $$\u222b (1/h(y)) dy = \u222b g(x) dx + C,$$ yielding an implicit solution for $y(x)$. This technique reduces solving the ODE to evaluating two antiderivatives.";
const EXAMPLE = "Solve $dy/dx = x y$ with $y(0)=2$.  Separate: $dy/y = x dx$. Integrate: $ln|y| = x^2/2 + C$. Exponentiate: $y = A e^{x^2/2}$. Using $y(0)=2$ gives $A=2$, so $y = 2 e^{x^2/2}$.";

function katexHtml(text: string): string {
  return renderToStaticMarkup(createElement(ReactMarkdown, { remarkPlugins: [remarkMath], rehypePlugins: [rehypeKatex], children: text }));
}

test("quick-check equations gain delimiters and already-delimited lesson text does not change", () => {
  expect(wrapBareMath("dy/dx = x + y")).toBe("$dy/dx = x + y$");
  expect(wrapBareMath("dy/dx = x^2 y^3")).toBe("$dy/dx = x^2 y^3$");
  expect(wrapBareMath("dy/dx = sin(x+y)")).toBe("$dy/dx = sin(x+y)$");
  expect(wrapBareMath("dy/dx = e^{x} + e^{y}")).toBe("$dy/dx = e^{x} + e^{y}$");
  expect(wrapBareMath("Which of the following first-order ODEs is separable?")).toBe("Which of the following first-order ODEs is separable?");
  expect(wrapBareMath("Thylakoid membrane")).toBe("Thylakoid membrane");
  expect(wrapBareMath("snake_case and max_iter stay words")).toBe("snake_case and max_iter stay words");
  expect(wrapBareMath(EXPL)).toBe(EXPL);
  expect(wrapBareMath(EXAMPLE)).toBe(EXAMPLE);
  expect(wrapBareMath("use `x^2` in code")).toBe("use `x^2` in code");
  expect(wrapBareMath("before\n```\nx^2\n```\nafter")).toBe("before\n```\nx^2\n```\nafter");
  expect(wrapBareMath("\\(e^{x}\\)")).toBe("$e^{x}$");
  expect(wrapBareMath("\\[dy/dx = x\\]")).toBe("$$dy/dx = x$$");
  expect(wrapBareMath("costs $5 and x^2")).toBe("costs \\$5 and $x^2$");
  expect(wrapBareMath("because x^2 holds [1]")).toBe("because $x^2$ holds [1]");
  expect(wrapBareMath("x = 50%")).toBe("$x = 50\\%$");
  expect(wrapBareMath("do x^2 next")).toBe("do $x^2$ next");
  const once = wrapBareMath("Only option B uses x^2 and e^{x}.");
  expect(wrapBareMath(once)).toBe(once);
  expect(wrapBareMath(wrapBareMath(EXPL))).toBe(EXPL);
});

test("delimited check math renders with KaTeX and bare LaTeX does not", () => {
  const bare = katexHtml("dy/dx = e^{x} + e^{y}");
  expect(bare).not.toContain("katex");
  const fixed = katexHtml(wrapBareMath("dy/dx = e^{x} + e^{y}"));
  expect(fixed).toContain("katex");
  expect(katexHtml(wrapBareMath("dy/dx = x^2 y^3"))).toContain("katex");
});
