// A whitelisted arithmetic language for scene expressions: numbers, x, declared params, + - * / ^, unary minus,
// parentheses, sin cos tan exp log sqrt abs, and the constants pi and e. It is evaluated by walking the tree.

export const EXPR_FUNCTIONS = ["sin", "cos", "tan", "exp", "log", "sqrt", "abs"] as const;
export type ExprFunction = (typeof EXPR_FUNCTIONS)[number];
export const EXPR_CONSTANTS = ["pi", "e"] as const;
export const EXPR_MAX_CHARS = 200;
const MAX_TOKENS = 120;
const MAX_DEPTH = 24;

export type Expr =
  | { op: "num"; value: number }
  | { op: "var"; name: string }
  | { op: "neg"; arg: Expr }
  | { op: "bin"; sym: "+" | "-" | "*" | "/" | "^"; left: Expr; right: Expr }
  | { op: "call"; fn: ExprFunction; arg: Expr };

export type ExprResult = { ok: true; expr: Expr } | { ok: false; error: string };

type Token = { kind: "num"; value: number } | { kind: "id"; name: string } | { kind: "sym"; sym: string };

const FN_SET: ReadonlySet<string> = new Set(EXPR_FUNCTIONS);
const NUMBER_RE = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/;
const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*/;
const SYMBOLS = "+-*/^()";
const FNS: Readonly<Record<ExprFunction, (v: number) => number>> = { sin: Math.sin, cos: Math.cos, tan: Math.tan, exp: Math.exp, log: Math.log, sqrt: Math.sqrt, abs: Math.abs };
const CONSTS: Readonly<Record<string, number>> = { pi: Math.PI, e: Math.E };

// O(1)
function fail(message: string): never {
  throw new Error(message);
}

// O(n) in source length
// SEC: only digits, identifiers, the six operator characters and parentheses tokenize; a dot outside a number, brackets, quotes or commas are rejected here
function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    if (out.length > MAX_TOKENS) fail("expression is too long");
    const rest = src.slice(i);
    const ws = /^\s+/.exec(rest);
    if (ws) {
      i += ws[0].length;
      continue;
    }
    const num = NUMBER_RE.exec(rest);
    if (num) {
      out.push({ kind: "num", value: Number(num[0]) });
      i += num[0].length;
      continue;
    }
    const id = IDENT_RE.exec(rest);
    if (id) {
      out.push({ kind: "id", name: id[0] });
      i += id[0].length;
      continue;
    }
    const c = src[i] ?? "";
    if (!SYMBOLS.includes(c)) fail(`unexpected '${c}' at position ${i + 1}`);
    out.push({ kind: "sym", sym: c });
    i++;
  }
  return out;
}

// O(n) in tokens
// INV: grammar, lowest precedence first: sum := term (('+'|'-') term)*; term := unary (('*'|'/') unary)*; unary := '-' unary | power; power := atom ('^' unary)?; atom := num | name | fn '(' sum ')' | '(' sum ')'
// INV: ^ binds tighter than unary minus and is right-associative, so -x^2 is -(x^2) and 2^3^2 is 2^(3^2)
function parseTokens(tokens: readonly Token[], vars: ReadonlySet<string>): Expr {
  let at = 0;
  let depth = 0;
  const peek = (): Token | undefined => tokens[at];
  const isSym = (s: string): boolean => {
    const t = peek();
    return t?.kind === "sym" && t.sym === s;
  };
  const expect = (s: string): void => {
    if (!isSym(s)) fail(`expected '${s}'`);
    at++;
  };
  const enter = (): void => {
    if (++depth > MAX_DEPTH) fail("expression is nested too deeply");
  };
  const sum = (): Expr => {
    enter();
    let left = term();
    while (isSym("+") || isSym("-")) {
      const sym = isSym("+") ? "+" : "-";
      at++;
      left = { op: "bin", sym, left, right: term() };
    }
    depth--;
    return left;
  };
  const term = (): Expr => {
    let left = unary();
    while (isSym("*") || isSym("/")) {
      const sym = isSym("*") ? "*" : "/";
      at++;
      left = { op: "bin", sym, left, right: unary() };
    }
    return left;
  };
  const unary = (): Expr => {
    if (isSym("-") || isSym("+")) {
      const neg = isSym("-");
      at++;
      enter();
      const arg = unary();
      depth--;
      return neg ? { op: "neg", arg } : arg;
    }
    return power();
  };
  const power = (): Expr => {
    const base = atom();
    if (!isSym("^")) return base;
    at++;
    enter();
    const exp = unary();
    depth--;
    return { op: "bin", sym: "^", left: base, right: exp };
  };
  const atom = (): Expr => {
    const t = peek();
    if (t === undefined) fail("expression ends too early");
    at++;
    if (t.kind === "num") return { op: "num", value: t.value };
    if (t.kind === "sym") {
      if (t.sym !== "(") fail(`unexpected '${t.sym}'`);
      const inner = sum();
      expect(")");
      return inner;
    }
    if (FN_SET.has(t.name)) {
      expect("(");
      const arg = sum();
      expect(")");
      return { op: "call", fn: t.name as ExprFunction, arg };
    }
    if (isSym("(")) fail(`'${t.name}' is not a function you can call`);
    if (Object.hasOwn(CONSTS, t.name) || vars.has(t.name)) return { op: "var", name: t.name };
    fail(`unknown name '${t.name}'`);
  };
  const out = sum();
  const left = peek();
  if (left !== undefined) fail(`unexpected '${left.kind === "sym" ? left.sym : left.kind === "id" ? left.name : String(left.value)}'`);
  return out;
}

// O(n) in source length
// SEC: the result is a plain tree; nothing reaches eval or Function, and only names in vars, EXPR_CONSTANTS and EXPR_FUNCTIONS are accepted
export function parseExpr(src: string, vars: readonly string[]): ExprResult {
  if (src.length > EXPR_MAX_CHARS) return { ok: false, error: "expression is too long" };
  if (src.trim() === "") return { ok: false, error: "expression is empty" };
  try {
    return { ok: true, expr: parseTokens(tokenize(src), new Set(vars)) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "expression could not be read" };
  }
}

// O(n) in tree size
// INV: an unbound variable reads as NaN, so a bad value draws nothing instead of throwing
export function evalExpr(expr: Expr, env: Readonly<Record<string, number>>): number {
  switch (expr.op) {
    case "num":
      return expr.value;
    case "var":
      if (Object.hasOwn(CONSTS, expr.name)) return CONSTS[expr.name] ?? Number.NaN;
      return Object.hasOwn(env, expr.name) ? (env[expr.name] ?? Number.NaN) : Number.NaN;
    case "neg":
      return -evalExpr(expr.arg, env);
    case "call":
      return FNS[expr.fn](evalExpr(expr.arg, env));
    case "bin": {
      const a = evalExpr(expr.left, env);
      const b = evalExpr(expr.right, env);
      if (expr.sym === "+") return a + b;
      if (expr.sym === "-") return a - b;
      if (expr.sym === "*") return a * b;
      if (expr.sym === "/") return a / b;
      return a ** b;
    }
  }
}
