// INV: already-delimited $…$ / $$…$$, fenced code, and inline code are copied through unchanged
export const MATH_DELIM_RULE: string = [
  "Write every mathematical expression as LaTeX inside $…$ or $$…$$.",
  "That applies to explanationMd, keyIdea, example, the check stem, each choice, and the check explanation.",
  "An equation that is a whole choice is one math span, for example $dy/dx = x^2 y^3$ or $e^{x}+e^{y}$.",
  "Never leave bare LaTeX such as e^{x}, x^2, dy/dx, or a backslash command such as frac.",
].join(" ");

const FUNCS = new Set(["arcsin", "arccos", "arctan", "sinh", "cosh", "tanh", "sin", "cos", "tan", "sec", "csc", "cot", "ln", "log", "exp", "lim", "det", "gcd", "max", "min", "sup", "inf", "dim", "ker", "deg", "mod", "arg", "sqrt"]);
const RELATIONS = new Set(["=", "+", "-", "*", "/", "<", ">", "\u2264", "\u2265", "\u2260", "\u2248", "\u00b1", "\u00d7", "\u00f7", "\u00b7", "\u2192", "\u21d2"]);
const FUNC_RE = /^(?:arcsin|arccos|arctan|sinh|cosh|tanh|sin|cos|tan|sec|csc|cot|ln|log|exp|lim|det|gcd|max|min|sup|inf|dim|ker|deg|mod|arg|sqrt)\s*[([]/;
const JOINERS = new Set([",", "...", "\u2026"]);
const SYMBOL_RE = /[\u222b\u2211\u220f\u221a\u2202\u2207\u221e\u2264\u2265\u2260\u2248\u2208\u2209\u2282\u2283\u222a\u2229\u03c0\u03b8\u03bb\u03bc\u03c3\u03c6\u03c9\u03b1\u03b2\u03b3\u03b4\u03b5\u03c1\u03c4\u0394\u03a3\u03a0\u03a9]/;

type Part = { keep: boolean; text: string };
type Tok = { ws: string; core: string; trail: string; anchor: boolean; math: boolean };
type Hit = { keep: boolean; n: number };

// O(n) in text length
// INV: wrapBareMath(wrapBareMath(text)) === wrapBareMath(text)
// INV: prose with no math anchors is unchanged, and bare equations gain $…$ delimiters
export function wrapBareMath(text: string): string {
  return scan(text, codeAt).map((p) => (p.keep ? p.text : wrapRegion(p.text))).join("");
}

function wrapRegion(text: string): string {
  const converted = text.replace(/\\\[([\s\S]+?)\\\]/g, (_m, g: string) => `$$${g}$$`).replace(/\\\(([\s\S]+?)\\\)/g, (_m, g: string) => `$${g}$`);
  if (converted !== text) return wrapRegion(converted);
  let out = "";
  let prevInline = false;
  for (const p of scan(converted, dollarAt)) {
    const text = p.keep ? fixSpan(p.text) : wrapPlain(p.text);
    const inline = p.keep && !text.startsWith("$$");
    out = prevInline && inline ? out.slice(0, -1) + " " + text.slice(1) : out + text;
    prevInline = inline;
  }
  return out;
}

function fixSpan(span: string): string {
  const d = span.startsWith("$$") ? "$$" : "$";
  return d + braceScripts(span.slice(d.length, -d.length)) + d;
}

function braceScripts(tex: string): string {
  return tex
    .replace(/(?<![A-Za-z\\])([A-Za-z}])\\_(?=[{\dA-Za-z(])/g, "$1_")
    .replace(/(?<!\\)_\(([^()\n]{1,24})\)/g, "_{$1}")
    .replace(/(?<!\\)_([A-Za-z]{2,}|\d{2,})(?![A-Za-z\d_^{]|\.\d)/g, "_{$1}");
}

function wrapPlain(text: string): string {
  const { toks, tail } = tokenize(text.replace(/(^|[^\\])\$/g, "$1\\$"));
  markMath(toks);
  return stitch(toks, tail);
}

function scan(text: string, at: (text: string, i: number) => Hit | null): Part[] {
  const out: Part[] = [];
  let buf = "";
  let i = 0;
  const flush = (): void => {
    if (buf === "") return;
    out.push({ keep: false, text: buf });
    buf = "";
  };
  while (i < text.length) {
    const hit = at(text, i);
    if (!hit) {
      buf += text[i];
      i++;
      continue;
    }
    if (!hit.keep) {
      buf += text.slice(i, hit.n);
      i = hit.n;
      continue;
    }
    flush();
    out.push({ keep: true, text: text.slice(i, hit.n) });
    i = hit.n;
  }
  flush();
  return out;
}

function codeAt(text: string, i: number): Hit | null {
  if (text.startsWith("```", i)) {
    const end = text.indexOf("```", i + 3);
    return { keep: end >= 0, n: end < 0 ? text.length : end + 3 };
  }
  if (text[i] !== "`") return null;
  const end = text.indexOf("`", i + 1);
  if (end < 0 || text.slice(i + 1, end).includes("\n")) return null;
  return { keep: true, n: end + 1 };
}

function dollarAt(text: string, i: number): Hit | null {
  if (text[i] === "\\" && text[i + 1] === "$") return { keep: false, n: i + 2 };
  if (text.startsWith("$$", i)) {
    const end = text.indexOf("$$", i + 2);
    return end < 0 ? { keep: false, n: i + 2 } : { keep: true, n: end + 2 };
  }
  if (text[i] !== "$") return null;
  const end = closeInline(text, i + 1);
  return end < 0 ? null : { keep: true, n: end + 1 };
}

function closeInline(text: string, from: number): number {
  for (let i = from; i < text.length; i++) {
    const c = text[i];
    if (c === "\n") return -1;
    if (c === "\\" && text[i + 1] === "$") {
      i++;
      continue;
    }
    if (text.startsWith("$$", i)) return i > from && /\S/.test(text[i - 1] ?? "") && /[^\s$]/.test(text[i + 2] ?? "") ? i : -1;
    if (c === "$") return i;
  }
  return -1;
}

function tokenize(text: string): { toks: Tok[]; tail: string } {
  const toks: Tok[] = [];
  let ws = "";
  for (const bit of text.split(/(\s+)/)) {
    if (bit === "") continue;
    if (/^\s+$/.test(bit)) {
      ws += bit;
      continue;
    }
    const peeled = peel(bit);
    toks.push({ ws, core: peeled.core, trail: peeled.trail, anchor: isAnchor(peeled.core), math: false });
    ws = "";
  }
  return { toks, tail: ws };
}

function peel(bit: string): { core: string; trail: string } {
  let core = bit;
  let trail = "";
  while (core.length > 0) {
    const c = core[core.length - 1] ?? "";
    if (!".,;:!?".includes(c)) break;
    trail = c + trail;
    core = core.slice(0, -1);
  }
  return core === "" ? { core: bit, trail: "" } : { core, trail };
}

function funcsOnly(core: string): boolean {
  return (core.match(/[A-Za-z]{3,}/g) ?? []).every((w) => FUNCS.has(w.toLowerCase()));
}

function isAnchor(core: string): boolean {
  if (/\\[a-zA-Z]{2,}/.test(core) || /d[a-z]{1,3}\/d?[a-z]{1,3}/.test(core) || FUNC_RE.test(core) || SYMBOL_RE.test(core)) return true;
  if (core.includes("=") && funcsOnly(core)) return true;
  for (const m of core.matchAll(/([A-Za-z0-9]+)(\^|_)(\{|\d|[A-Za-z]|\()/g)) {
    const base = m[1] ?? "";
    if (base.length <= 2 || /^\d+$/.test(base)) return true;
    if (FUNCS.has(base.toLowerCase()) && !/[A-Za-z]/.test(core[(m.index ?? 0) + m[0].length] ?? "")) return true;
  }
  return false;
}

function isAbsorbable(core: string): boolean {
  if (/^\[\d{1,9}\]$/.test(core)) return false;
  if (RELATIONS.has(core) || /^[A-Za-z](?:['\u2032])?[)\]']*$/.test(core) || /^[+\-][A-Za-z]$/.test(core)) return true;
  if (/^d[a-z][)\]']*$/.test(core) && !/^d(?:o|e|i)[)\]']*$/.test(core)) return true;
  if (/^[+\-\u00b1]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?%?$/.test(core) || /^\d+\/\d+$/.test(core)) return true;
  if (/^[A-Za-z]{1,8}\s*\(/.test(core) && funcsOnly(core)) return true;
  return /^[(\[]/.test(core) && funcsOnly(core) && (/[0-9\\^_=+\-*/<>]/.test(core) || /^[(\[][A-Za-z][)\]]$/.test(core));
}

function markMath(toks: Tok[]): void {
  const math = toks.map((t) => t.anchor);
  const q: number[] = [];
  for (let i = 0; i < toks.length; i++) if (math[i]) q.push(i);
  for (let i = 0; i < toks.length; i++) {
    if (math[i] || !relationBetween(toks, i)) continue;
    math[i] = true;
    q.push(i);
  }
  while (q.length > 0) {
    const i = q.pop();
    if (i === undefined) continue;
    if (i > 0 && tryMark(toks, math, i, i - 1)) q.push(i - 1);
    if (i + 1 < toks.length && tryMark(toks, math, i, i + 1)) q.push(i + 1);
  }
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t) t.math = math[i] === true;
  }
}

function gap(toks: Tok[], i: number): boolean {
  return !toks[i]?.ws.includes("\n");
}

function sideOk(t: Tok | undefined): boolean {
  return t !== undefined && (t.anchor || isAbsorbable(t.core));
}

function relationBetween(toks: Tok[], i: number): boolean {
  const cur = toks[i];
  return cur !== undefined && RELATIONS.has(cur.core) && gap(toks, i) && gap(toks, i + 1) && sideOk(toks[i - 1]) && sideOk(toks[i + 1]);
}

function tryMark(toks: Tok[], math: boolean[], from: number, to: number): boolean {
  if (math[to]) return false;
  const dest = toks[to];
  const src = toks[from];
  if (!dest || !src || !(to > from ? gap(toks, to) : gap(toks, from))) return false;
  if (isAbsorbable(dest.core) && !RELATIONS.has(dest.core)) {
    math[to] = true;
    return true;
  }
  if (!RELATIONS.has(dest.core) && !JOINERS.has(dest.core)) return false;
  const far = to > from ? to + 1 : to - 1;
  const other = toks[far];
  if (!other || !(to > from ? gap(toks, far) : gap(toks, to))) return false;
  if (!(other.anchor || isAbsorbable(other.core) || math[far] === true)) return false;
  math[to] = true;
  return true;
}

function stitch(toks: Tok[], tail: string): string {
  let out = "";
  let i = 0;
  while (i < toks.length) {
    const cur = toks[i];
    if (!cur) break;
    if (!cur.math) {
      out += cur.ws + cur.core + cur.trail;
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < toks.length && toks[j + 1]?.math && gap(toks, j + 1)) j++;
    out += emitGroup(toks, i, j);
    i = j + 1;
  }
  return out + tail;
}

function rawSpan(toks: Tok[], i: number, j: number): string {
  let raw = "";
  for (let k = i; k <= j; k++) {
    const t = toks[k];
    if (t) raw += t.ws + t.core + t.trail;
  }
  return raw;
}

function emitGroup(toks: Tok[], i: number, j: number): string {
  const first = toks[i];
  const last = toks[j];
  let worth = false;
  for (let k = i; k <= j && !worth; k++) {
    const t = toks[k];
    worth = t !== undefined && (t.anchor || RELATIONS.has(t.core));
  }
  if (!first || !last || !worth) return rawSpan(toks, i, j);
  let inner = "";
  for (let k = i; k <= j; k++) {
    const t = toks[k];
    if (!t) continue;
    if (k > i && t.core !== ",") inner += t.ws;
    inner += t.core;
    if (k < j) inner += t.trail;
  }
  inner = braceScripts(inner.trim().replace(/([^\\]|^)([%#&])/g, "$1\\$2"));
  if (inner === "" || inner.includes("$") || inner.includes("`") || inner.includes("\n")) return rawSpan(toks, i, j);
  return first.ws + "$" + inner + "$" + last.trail;
}
