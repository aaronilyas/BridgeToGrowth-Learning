// The Markdown dialect the app renders: CommonMark plus GitHub tables (remark-gfm) and $…$ / $$…$$ math (remark-math).
// Model output is repaired toward it at render time (normalizeMarkdown) and cut without breaking it (truncateMarkdown).

export const MARKDOWN_RULE: string = [
  "Format all text as Markdown: paragraphs separated by a blank line, and Markdown lists with one item per line.",
  "Use a table only for a small grid of values, such as a truth table or a side-by-side comparison, with at most 6 columns and 8 rows.",
  "Write a table as a header row, then a delimiter row such as |---|---|, then one row per line. Give every row the same number of cells, and put a blank line before and after the table.",
  "Never put a list, a line break or a | character inside a table cell. Inside a cell write an absolute value as $\\lvert x \\rvert$.",
  "Never use HTML tags or images.",
].join(" ");

type Line = { text: string; start: number; end: number };
type Block = { start: number; end: number; atomic: boolean };

const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/;
const DELIM_CELL_RE = /^\s*:?-+:?\s*$/;
const LIST_ITEM_RE = /^\s*(?:[-*+]|\d{1,9}[.)])\s/;
const ABBREV_RE = /^(?:e\.g|i\.e|vs|cf)\.$/i;
// A word is a run of non-space characters, where an inline $…$ math or `…` code span counts as part of one word even if it holds spaces.
const WORD_RE = /(?:\$\$[\s\S]*?\$\$|\$(?:\\.|[^$\\\n])+?\$|`[^`\n]*`|\\.|[^\s$`\\]|[$`\\])+/g;

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
// INV: returns the index of the last line of the fence or $$ display block that starts at i, or -1 if line i opens neither
function atomicEnd(lines: Line[], i: number): number {
  const line = lines[i]?.text ?? "";
  const fence = FENCE_RE.exec(line);
  if (fence) {
    const mark = fence[1] ?? "```";
    for (let j = i + 1; j < lines.length; j++) if ((lines[j]?.text ?? "").trimStart().startsWith(mark)) return j;
    return lines.length - 1;
  }
  const t = line.trim();
  if (!t.startsWith("$$")) return -1;
  if (t.length > 2 && t.indexOf("$$", 2) >= 0) return i;
  for (let j = i + 1; j < lines.length; j++) if ((lines[j]?.text ?? "").includes("$$")) return j;
  return lines.length - 1;
}

// O(n) in text length
// INV: blocks are in order, never overlap, and never include blank separator lines; fences, display math and tables are atomic
function splitBlocks(text: string): Block[] {
  const lines = splitLines(text);
  const texts = lines.map((l) => l.text);
  const out: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line || isBlank(line.text)) {
      i++;
      continue;
    }
    const fenceEnd = atomicEnd(lines, i);
    const tblEnd = tableEnd(texts, i);
    let j = i;
    let atomic = true;
    if (fenceEnd >= 0) j = fenceEnd;
    else if (tblEnd >= 0) j = tblEnd;
    else {
      atomic = false;
      while (j + 1 < lines.length) {
        if (isBlank(texts[j + 1] ?? "") || tableEnd(texts, j + 1) >= 0 || atomicEnd(lines, j + 1) >= 0) break;
        j++;
      }
    }
    out.push({ start: line.start, end: lines[j]?.end ?? line.end, atomic });
    i = j + 1;
  }
  return out;
}

// O(n) in block length
// INV: returns, in order, the offset after each word at which the block may end cleanly (a sentence end, or the end of a line before a list item), each with the number of words up to it
function cutPoints(text: string, from: number, to: number): { at: number; words: number }[] {
  const block = text.slice(from, to);
  const words = [...block.matchAll(WORD_RE)];
  const out: { at: number; words: number }[] = [];
  words.forEach((m, k) => {
    const word = m[0];
    const end = (m.index ?? 0) + word.length;
    const lineStart = block.lastIndexOf("\n", (m.index ?? 0) - 1) + 1;
    const firstOnLine = block.slice(lineStart, m.index).trim() === "";
    const marker = firstOnLine && LIST_ITEM_RE.test(block.slice(lineStart) + " ") && /^(?:[-*+]|\d{1,9}[.)])$/.test(word);
    const nextNl = block.indexOf("\n", end);
    const restOfLine = nextNl < 0 ? block.slice(end) : block.slice(end, nextNl);
    const lineEnds = restOfLine.trim() === "";
    const beforeItem = lineEnds && (nextNl < 0 || LIST_ITEM_RE.test(block.slice(nextNl + 1)));
    const sentence = /[.!?]["')\]*_]*$/.test(word) && !word.endsWith("$") && !ABBREV_RE.test(word);
    if (!marker && (sentence || beforeItem)) out.push({ at: from + end, words: k + 1 });
  });
  return out;
}

// O(n) in block length
function nthWordEnd(text: string, from: number, to: number, n: number): number {
  let k = 0;
  for (const m of text.slice(from, to).matchAll(WORD_RE)) {
    k++;
    if (k === n) return from + (m.index ?? 0) + m[0].length;
  }
  return to;
}

// O(n) in text length
// INV: counts the words of prose only; tables, fenced code and display math are never counted, never cut and kept whole while the limit is not reached
// INV: a cut lands at the end of a sentence, or of a list item, so no table row, list item, math span or code span is left broken; only the first block is ever cut mid-sentence
// INV: keeps the text's own whitespace, so paragraph breaks and Markdown lists survive
export function truncateMarkdown(text: string, maxWords: number): string {
  let used = 0;
  let end = 0;
  for (const b of splitBlocks(text)) {
    if (used >= maxWords) break;
    if (b.atomic) {
      end = b.end;
      continue;
    }
    const n = [...text.slice(b.start, b.end).matchAll(WORD_RE)].length;
    if (used + n <= maxWords) {
      used += n;
      end = b.end;
      continue;
    }
    const room = maxWords - used;
    const fit = cutPoints(text, b.start, b.end).filter((c) => c.words <= room).pop();
    if (fit) end = fit.at;
    else if (end === 0) end = nthWordEnd(text, b.start, b.end, room);
    used = maxWords;
  }
  return text.slice(0, end).trimEnd();
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
