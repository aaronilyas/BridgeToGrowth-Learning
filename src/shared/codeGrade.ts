import { z } from "zod";
import { CODE_MAX_CHARS, CODE_MAX_LIBRARIES, CODE_MAX_TESTS, CodeLibrary, CodeTest, CodeTestResult, type CodeSpec } from "./code.ts";

export const HarnessRun = z.strictObject({ stdout: z.string(), stderr: z.string(), error: z.string().nullable(), tests: z.array(CodeTestResult).max(CODE_MAX_TESTS) });
export type HarnessRun = z.infer<typeof HarnessRun>;

// INV: questions.answer for a code question; the reference solution stays stored until an attempt is recorded
export const StoredCodeAnswer = z.strictObject({ tests: z.array(CodeTest).min(1).max(CODE_MAX_TESTS), model: z.string() });
export type StoredCodeAnswer = z.infer<typeof StoredCodeAnswer>;

export type LineTest = { name: string; lines: readonly string[] };

// O(n) in output size
// SEC: only the last nonce-prefixed line is parsed, and it must match the schema
export function parseHarnessLine<T>(stdout: string, nonce: string, schema: z.ZodType<T>): T | null {
  const at = stdout.lastIndexOf(`\n${nonce}`);
  if (at < 0) return null;
  const line = stdout.slice(at + 1 + nonce.length).split("\n", 1)[0] ?? "";
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return null;
  }
  const r = schema.safeParse(raw);
  return r.success ? r.data : null;
}

// O(t)
// INV: score is the share of hidden tests passed; 0 when there are none
export function scoreTests(results: readonly CodeTestResult[]): number {
  return results.length === 0 ? 0 : results.filter((r) => r.passed).length / results.length;
}

// O(t)
export function codeFeedback(r: HarnessRun): string {
  const passed = r.tests.filter((t) => t.passed).length;
  const head = `${passed} of ${r.tests.length} tests passed.`;
  return (r.error ? `${head} Your code raised an error: ${r.error}` : head).slice(0, 600);
}

// O(n) in code length
// INV: models in strict JSON mode may emit no escape sequences, so code arrives as one string per source line; trailing spaces and leading/trailing blank lines are dropped, indentation is kept; null if empty or over CODE_MAX_CHARS
function joinCodeLines(lines: readonly string[] | null): string | null {
  const ls = (lines ?? []).flatMap((l) => l.split(/\r?\n/)).map((l) => l.trimEnd());
  while (ls.length > 0 && ls[0] === "") ls.shift();
  while (ls.length > 0 && ls[ls.length - 1] === "") ls.pop();
  const code = ls.join("\n");
  return code === "" || code.length > CODE_MAX_CHARS ? null : code;
}

// O(n) in spec size
// INV: null unless every library is in the catalog, there are 1..CODE_MAX_TESTS non-empty tests, and a reference solution is present; an empty starter is allowed
export function toCodeParts(starter: readonly string[] | null, libraries: readonly CodeLibrary[] | null, tests: readonly LineTest[] | null, solution: readonly string[] | null, available: readonly CodeLibrary[]): { spec: CodeSpec; answer: StoredCodeAnswer } | null {
  const libs = [...new Set(libraries ?? [])];
  if (libs.length > CODE_MAX_LIBRARIES || libs.some((l) => !available.includes(l))) return null;
  const ts: CodeTest[] = [];
  for (const t of tests ?? []) {
    const code = joinCodeLines(t.lines);
    const name = t.name.trim();
    if (code !== null && name !== "") ts.push({ name, code });
  }
  const ref = joinCodeLines(solution);
  if (ts.length === 0 || ts.length > CODE_MAX_TESTS || ref === null) return null;
  return { spec: { language: "python", starter: joinCodeLines(starter) ?? "", libraries: libs }, answer: { tests: ts, model: ref } };
}

// O(t)
// INV: same names in the same order as the stored hidden tests
export function sameTestNames(stored: readonly { name: string }[], got: readonly { name: string }[]): boolean {
  return stored.length === got.length && stored.every((t, i) => got[i]?.name === t.name);
}
