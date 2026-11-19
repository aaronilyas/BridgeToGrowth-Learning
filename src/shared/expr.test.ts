import { expect, test } from "bun:test";
import { evalExpr, parseExpr } from "./expr.ts";

// O(1)
function value(src: string, env: Record<string, number> = {}, vars: string[] = ["x", "a"]): number {
  const r = parseExpr(src, vars);
  if (!r.ok) throw new Error(r.error);
  return evalExpr(r.expr, env);
}

test("the parser accepts the whitelist: numbers, x, params, operators, functions and constants", () => {
  expect(value("1 + 2 * 3")).toBe(7);
  expect(value("(1 + 2) * 3")).toBe(9);
  expect(value("2^3^2")).toBe(512);
  expect(value("-x^2", { x: 3 })).toBe(-9);
  expect(value("a*x - 1/2", { x: 4, a: 0.5 })).toBe(1.5);
  expect(value("1.5e2 + .5")).toBe(150.5);
  expect(value("sin(pi/2) + cos(0) + tan(0)")).toBeCloseTo(2);
  expect(value("exp(1) - e")).toBeCloseTo(0);
  expect(value("log(e^2) + sqrt(16) + abs(-3)")).toBeCloseTo(9);
  expect(value("--x", { x: 2 })).toBe(2);
});

test("the parser rejects identifiers outside the declared names", () => {
  for (const src of ["y + 1", "window", "constructor", "toString", "__proto__", "Math", "globalThis", "process", "b * x"]) {
    const r = parseExpr(src, ["x", "a"]);
    expect(r.ok).toBe(false);
  }
  expect(parseExpr("a", ["x"]).ok).toBe(false);
  expect(parseExpr("x", []).ok).toBe(false);
});

test("the parser rejects member access, calls outside the list and other syntax", () => {
  const bad = [
    "Math.sin(x)",
    "x.constructor",
    "sin.call(x)",
    "x['constructor']",
    "alert(1)",
    "eval(x)",
    "Function(x)",
    "a(x)",
    "x(2)",
    "sin(x, 2)",
    "max(1, 2)",
    "\"x\"",
    "`x`",
    "x => x",
    "x; 1",
    "x = 1",
    "2x",
    "sin x",
    "(x",
    "x)",
    "",
    "1 +",
  ];
  for (const src of bad) expect({ src, ok: parseExpr(src, ["x", "a"]).ok }).toEqual({ src, ok: false });
});

test("the parser bounds length and nesting", () => {
  expect(parseExpr("x+".repeat(150) + "x", ["x"]).ok).toBe(false);
  expect(parseExpr(`${"(".repeat(40)}x${")".repeat(40)}`, ["x"]).ok).toBe(false);
  expect(parseExpr(`${"(".repeat(5)}x${")".repeat(5)}`, ["x"]).ok).toBe(true);
});

test("an unbound variable evaluates to NaN instead of throwing", () => {
  const r = parseExpr("x + a", ["x", "a"]);
  expect(r.ok).toBe(true);
  if (r.ok) expect(Number.isNaN(evalExpr(r.expr, { x: 1 }))).toBe(true);
});
