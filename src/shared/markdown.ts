// The Markdown dialect the app renders: CommonMark plus GitHub tables (remark-gfm) and $…$ / $$…$$ math (remark-math).
// Model output is repaired toward it at render time (normalizeMarkdown).

export const MARKDOWN_RULE: string = [
  "Format all text as Markdown: paragraphs separated by a blank line, and Markdown lists with one item per line.",
  "Use a table only for a small grid of values, such as a truth table or a side-by-side comparison, with at most 6 columns and 8 rows.",
  "Write a table as a header row, then a delimiter row such as |---|---|, then one row per line. Give every row the same number of cells, and put a blank line before and after the table.",
  "Never put a list, a line break or a | character inside a table cell. Inside a cell write an absolute value as $\\lvert x \\rvert$.",
  "Never use HTML tags or image links.",
].join(" ");

const SCENE_EXAMPLE = [
  "```scene",
  '{"width": 480, "height": 300,',
  ' "axes": {"x": [-3, 3], "y": [-1, 5]},',
  ' "params": [{"name": "a", "min": 0.5, "max": 2, "step": 0.1, "value": 1, "label": "a"}],',
  ' "objects": [{"id": "ax", "type": "axes", "xLabel": "x", "yLabel": "y"},',
  '  {"id": "f", "type": "graph", "fn": "a*x^2", "color": "accent"},',
  '  {"id": "p", "type": "point", "at": [1, "a"], "label": "(1, a)"}],',
  ' "steps": [{"action": "create", "id": "f", "duration": 1.5, "caption": "The parabola opens upward because a > 0."},',
  '  {"action": "fadeIn", "id": "p", "duration": 1, "caption": "At x = 1 the height equals a."},',
  '  {"action": "indicate", "id": "p", "duration": 1, "caption": "Watch this point as a changes."},',
  '  {"action": "setParam", "param": "a", "value": 2, "duration": 2, "caption": "Doubling a doubles every height."}]}',
  "```",
].join("\n");

// INV: the scene schema text matches Scene in src/shared/visual.ts
export const VISUAL_RULE: string = [
  "A visual is a fenced block the app renders: plot (matplotlib code), scene (JSON animation), or diagram (Mermaid).",
  "A visual belongs only in an explanation. Never put one in a question, a check, a choice or a prompt you pose to the learner.",
  "Draw a visual only when the learner asks for one, or when you judge that it makes your explanation clearer because the idea is spatial, changes over time, or depends on a parameter. Otherwise draw none. A definition or a single formula needs none.",
  "One visual per turn at most, placed after the sentence it illustrates; the prose still teaches the idea without it.",
  "plot code uses only numpy and matplotlib.pyplot, builds one labelled figure with titled axes, and never calls show, savefig or open.",
  "scene JSON follows the schema below exactly; each step's caption names what the learner should notice.",
  "diagram uses Mermaid flowchart, stateDiagram or sequenceDiagram syntax.",
  "Never describe a visual you did not draw.",
  "Open a visual with ```plot, ```scene or ```diagram on its own line and close it with ``` on its own line. plot code is at most 60 lines; a diagram is at most 40 lines and has no %%{ directives or click lines.",
  "Scene schema: {width 200-960, height 120-720, axes?: {x: [min, max], y: [min, max]}, params?: up to 3 of {name, min, max, step, value?, label?}, objects: 1 to 20, steps: 0 to 12}.",
  "Each object has an id and a type: axes {grid?, xLabel?, yLabel?}; graph {fn, domain?: [a, b]}; point {at: [x, y], label?}; vector {from?: [x, y], to: [x, y], label?}; line {from, to}; circle {center, r}; polygon {points: 3 to 12 [x, y]}; label {at, text}. Any object may set color to accent, accent-2, text, muted or danger.",
  "A coordinate is a number or an expression in the params. fn is an expression in x and the params. Expressions use only numbers, + - * / ^, parentheses, sin cos tan exp log sqrt abs, pi and e; write every product with *. text, labels, xLabel and yLabel are KaTeX without $ delimiters.",
  "Each step has an action, a duration in seconds of at most 3, and an optional caption: create, fadeIn, fadeOut or indicate {id}; transform {id, target} turns object id into object target; moveTo {id, to: [x, y]} moves a point, label, circle or vector; setParam {param, value} animates a slider.",
  "An object named by a create or fadeIn step, or used as a transform target, starts hidden; every other object starts visible. Example:",
  SCENE_EXAMPLE,
].join("\n");

type Line = { text: string; start: number; end: number };
type Block = { start: number; end: number; atomic: boolean };

const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/;
const DELIM_CELL_RE = /^\s*:?-+:?\s*$/;

// O(n) in text length
function splitLines(text: string): Line[] {
  const out: Line[] = [];
  let start = 0;
  for (const part of text.split("\n")) {
    out.push({ text: part, start, end: start + part.length });
    start += part.length + 1;
  }
  return out;
}

function isTableLine(s: string): boolean {
  return s.trimStart().startsWith("|");
}

function isBlank(s: string): boolean {
  return s.trim() === "";
}

// O(n) in line length
function isDelimRow(s: string): boolean {
  const cells = s.trim().replace(/^\|/, "").replace(/\|$/, "").split("|");
  return isTableLine(s) && cells.length > 0 && cells.every((c) => DELIM_CELL_RE.test(c));
}

// O(n) in line count
// INV: a table is a run of | lines whose second line is a delimiter row; returns the index of its last line, or -1 if no table starts at i
function tableEnd(lines: readonly string[], i: number): number {
  if (!isTableLine(lines[i] ?? "") || !isDelimRow(lines[i + 1] ?? "")) return -1;
  let j = i + 1;
  while (j + 1 < lines.length && isTableLine(lines[j + 1] ?? "")) j++;
  return j;
}

// O(n) in line count
// INV: returns the index of the last line of the fence, $$ / \[ display block that starts at i, or -1 if line i opens none of them
function atomicEnd(lines: Line[], i: number): number {
  const line = lines[i]?.text ?? "";
  const fence = FENCE_RE.exec(line);
  if (fence) {
    const mark = fence[1] ?? "```";
    for (let j = i + 1; j < lines.length; j++) if ((lines[j]?.text ?? "").trimStart().startsWith(mark)) return j;
    return lines.length - 1;
  }
  const t = line.trim();
  if (t.startsWith("$$")) {
    if (t.length > 2 && t.indexOf("$$", 2) >= 0) return i;
    for (let j = i + 1; j < lines.length; j++) if ((lines[j]?.text ?? "").includes("$$")) return j;
    return lines.length - 1;
  }
  if (t.startsWith("\\[")) {
    if (t.includes("\\]")) return i;
    for (let j = i + 1; j < lines.length; j++) if ((lines[j]?.text ?? "").includes("\\]")) return j;
    return lines.length - 1;
  }
  return -1;
}

type Kind = "blank" | "atomic" | "list" | "quote" | "indent" | "ref" | "other";

// O(1)
function classify(s: string): { kind: Kind; list: string | null } {
  if (isBlank(s)) return { kind: "blank", list: null };
  if (/^(?: {4}|\t)/.test(s)) return { kind: "indent", list: null };
  if (/^ {0,3}\[[^\]]*\]:/.test(s)) return { kind: "ref", list: null };
  if (/^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})[ \t]*$/.test(s)) return { kind: "other", list: null };
  const bullet = /^ {0,3}([-+*])(?:[ \t]|$)/.exec(s);
  if (bullet) return { kind: "list", list: bullet[1] ?? null };
  const ordered = /^ {0,3}\d{1,9}([.)])(?:[ \t]|$)/.exec(s);
  if (ordered) return { kind: "list", list: ordered[1] ?? null };
  if (/^ {0,3}>/.test(s)) return { kind: "quote", list: null };
  return { kind: "other", list: null };
}

type Group = { last: Kind | null; listMarker: string | null };

// O(1)
// INV: true only when the next line can continue the group across a blank line. Merging is always safe, so this errs toward continuing:
// a group holding a list continues on an item with the same marker or on any line with leading whitespace (item content, a nested list, an indented fence or display), since such a line may belong to the item; a blockquote continues on a quote; indented code on indented code
function continues(group: Group, next: { kind: Kind; list: string | null }, nextLine: string): boolean {
  if (group.listMarker !== null && ((next.kind === "list" && next.list === group.listMarker) || /^[ \t]/.test(nextLine))) return true;
  if (group.last === "quote") return next.kind === "quote";
  if (group.last === "indent") return next.kind === "indent";
  return false;
}

// O(1)
function sliceLines(text: string, lines: readonly Line[], from: number, to: number): string {
  const start = lines[from]?.start ?? 0;
  const end = to + 1 < lines.length ? (lines[to + 1]?.start ?? text.length) : text.length;
  return text.slice(start, end);
}

// O(n) in line count
// INV: splitMarkdownBlocks(text).join("") === text
// INV: a table, fence or $$ / \[ display is one atomic range and is never split, including while it is still open
// INV: a split is only at a blank line whose next non-blank line cannot continue the group before it (see continues); link/footnote definitions keep the whole text as one block
export function splitMarkdownBlocks(text: string): string[] {
  if (text === "") return [""];
  const lines = splitLines(text);
  const texts = lines.map((l) => l.text);
  const units: Block[] = [];
  for (let i = 0; i < lines.length; ) {
    const table = tableEnd(texts, i);
    const end = table >= 0 ? table : atomicEnd(lines, i);
    if (end >= 0) {
      units.push({ start: i, end, atomic: true });
      i = end + 1;
    } else {
      units.push({ start: i, end: i, atomic: false });
      i++;
    }
  }
  const kindOf = (u: Block): { kind: Kind; list: string | null } => (u.atomic ? { kind: "atomic", list: null } : classify(texts[u.start] ?? ""));
  if (units.some((u) => kindOf(u).kind === "ref")) return [text];
  const out: string[] = [];
  let i = 0;
  while (i < units.length) {
    const first = units[i];
    if (!first) break;
    let end = i;
    // INV: last is the kind of the group's latest non-blank line; listMarker is the marker of its top-level list, kept through nested and indented content (a list line with leading whitespace only sets it when the group has none)
    const group: Group = { last: null, listMarker: null };
    for (let j = i; j < units.length; ) {
      const u = units[j];
      if (!u) break;
      const k = kindOf(u);
      if (k.kind === "blank") {
        let next = j;
        while (next < units.length && kindOf(units[next] ?? first).kind === "blank") next++;
        end = next - 1;
        if (next >= units.length) break;
        const nextUnit = units[next] ?? first;
        if (group.last === null || continues(group, kindOf(nextUnit), texts[nextUnit.start] ?? "")) {
          j = next;
          continue;
        }
        break;
      }
      end = j;
      group.last = k.kind;
      if (k.kind === "list" && (group.listMarker === null || !/^[ \t]/.test(texts[u.start] ?? ""))) group.listMarker = k.list;
      j++;
    }
    out.push(sliceLines(text, lines, first.start, units[end]?.end ?? first.end));
    i = end + 1;
  }
  return out.length > 0 ? out : [text];
}

// O(n) in line length
// INV: returns the offsets of the line's | characters that separate cells: those outside $…$ math and `…` code and not escaped
function cellPipes(line: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "\\") {
      i++;
      continue;
    }
    if (c === "$" || c === "`") {
      const close = closeSpan(line, i);
      if (close > i) {
        i = close;
        continue;
      }
    }
    if (c === "|") out.push(i);
  }
  return out;
}

// O(n) in line length
// INV: returns the offset of the last character of the $…$, $$…$$ or `…` span that opens at i, or -1 if it never closes on this line
// INV: a single-$ span must not start or end with a space, so prices such as "$5 | $10" never pair up as math
function closeSpan(line: string, i: number): number {
  const mark = line.startsWith("$$", i) ? "$$" : line[i] ?? "";
  if (mark === "$" && /\s/.test(line[i + 1] ?? " ")) return -1;
  for (let j = i + mark.length; j < line.length; j++) {
    if (line[j] === "\\" && mark !== "`") {
      j++;
      continue;
    }
    if (!line.startsWith(mark, j)) continue;
    if (mark === "$" && /\s/.test(line[j - 1] ?? " ")) return -1;
    return j + mark.length - 1;
  }
  return -1;
}

// O(n) in line length
// INV: a table whose rows were run together onto one line ("| a | b | |---|---| | 1 | 2 |") comes back as one row per line; any other line comes back unchanged
function splitRunTogetherTable(line: string): string[] {
  if (!isTableLine(line)) return [line];
  const pipes = cellPipes(line);
  const segs: string[] = [];
  for (let k = 0; k + 1 < pipes.length; k++) segs.push(line.slice((pipes[k] ?? 0) + 1, pipes[k + 1]));
  const k = segs.findIndex((s, idx) => idx > 0 && DELIM_CELL_RE.test(s) && isBlank(segs[idx - 1] ?? "x"));
  const cols = k - 1;
  if (k < 0 || cols < 1 || segs.slice(0, cols).every(isBlank)) return [line];
  const rows: string[] = [];
  let at = 0;
  while (at < segs.length) {
    const cells = segs.slice(at, at + cols);
    rows.push(`|${cells.join("|")}|`);
    at += cols;
    if (at < segs.length && !isBlank(segs[at] ?? "")) return [line];
    at += 1;
  }
  return rows.length >= 2 && (rows[1] ?? "").split("|").slice(1, -1).every((c) => DELIM_CELL_RE.test(c)) ? rows : [line];
}

// O(n) in line length
// INV: inside a table row, a | within $…$ math becomes \vert{} (and \| becomes \Vert{}), so it no longer splits the cell
function escapeMathPipes(line: string): string {
  let out = "";
  for (let i = 0; i < line.length; i++) {
    const c = line[i] ?? "";
    if (c === "\\") {
      out += line.slice(i, i + 2);
      i++;
      continue;
    }
    const close = c === "$" || c === "`" ? closeSpan(line, i) : -1;
    if (close < 0) {
      out += c;
      continue;
    }
    const span = line.slice(i, close + 1);
    out += c === "`" ? span : span.replace(/\\\||\\.|\|/g, (m) => (m === "\\|" ? "\\Vert{}" : m === "|" ? "\\vert{}" : m));
    i = close;
  }
  return out;
}

// O(n) in text length
// INV: fenced code is copied through unchanged; text without a table is unchanged
// INV: normalizeMarkdown(normalizeMarkdown(text)) === normalizeMarkdown(text)
// Repairs the table mistakes models make: rows run together on one line, no blank line around the table, and | inside math in a cell.
export function normalizeMarkdown(text: string): string {
  const lines: string[] = [];
  let fence: string | null = null;
  for (const raw of text.split("\n")) {
    if (fence !== null) {
      lines.push(raw);
      if (raw.trimStart().startsWith(fence)) fence = null;
      continue;
    }
    const open = FENCE_RE.exec(raw);
    if (open) fence = open[1] ?? "```";
    lines.push(...(open ? [raw] : splitRunTogetherTable(raw)));
  }
  const out: string[] = [];
  let i = 0;
  fence = null;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    const open: RegExpExecArray | null = fence === null ? FENCE_RE.exec(line) : null;
    if (fence !== null || open) {
      if (open) fence = open[1] ?? "```";
      else if (fence !== null && line.trimStart().startsWith(fence)) fence = null;
      out.push(line);
      i++;
      continue;
    }
    const end = tableEnd(lines, i);
    if (end < 0) {
      out.push(line);
      i++;
      continue;
    }
    if (out.length > 0 && !isBlank(out[out.length - 1] ?? "")) out.push("");
    for (let j = i; j <= end; j++) out.push(escapeMathPipes(lines[j] ?? ""));
    if (end + 1 < lines.length && !isBlank(lines[end + 1] ?? "")) out.push("");
    i = end + 1;
  }
  return out.join("\n");
}
