// Bench fixtures: deterministic tutor-style Markdown. Not imported by the app.

const PARAS = [
  "The derivative measures how fast $f(x)$ changes as $x$ moves. For $f(x) = x^2$ we get $f'(x) = 2x$, so the slope at $x = 3$ is $6$.",
  "$$\n\\int_0^1 x^2 \\, dx = \\frac{1}{3}\n$$",
  "| $x$ | $f(x)$ | $f'(x)$ |\n|---|---|---|\n| 0 | 0 | 0 |\n| 1 | 1 | 2 |\n| 2 | 4 | 4 |\n| 3 | 9 | 6 |",
  "1. Write the limit $\\lim_{h \\to 0} \\frac{f(x+h) - f(x)}{h}$.\n2. Expand $(x+h)^2 = x^2 + 2xh + h^2$.\n3. Cancel and let $h \\to 0$.",
  "```python\ndef slope(f, x, h=1e-6):\n    return (f(x + h) - f(x)) / h\n```",
  "A **key idea**: the chain rule says $\\frac{d}{dx} g(h(x)) = g'(h(x)) \\cdot h'(x)$. Try it on $\\sin(x^2)$ and you get $2x \\cos(x^2)$.",
  "$$\n\\sum_{n=1}^{\\infty} \\frac{1}{n^2} = \\frac{\\pi^2}{6}\n$$",
  "Notice that the area under $y = e^{-x^2}$ over the whole line is $\\sqrt{\\pi}$, which you will meet again in probability.",
];

// O(n) in length
// INV: same output for the same length; blocks are separated by a blank line like model output
export function tutorReply(length: number, seed = 0): string {
  let out = "";
  for (let i = seed; out.length < length; i++) out += (out === "" ? "" : "\n\n") + PARAS[i % PARAS.length];
  return out.slice(0, length);
}

// O(1)
export function shortReply(i: number): string {
  return tutorReply(300 + (i * 97) % 900, i);
}
