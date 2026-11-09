import type { QuestionRow } from "./learn/core.ts";

const DAY_MS = 86_400_000;

// O(1)
export function epochOf(d: Date): number {
  return d.getTime();
}

// O(1)
export function dateFromMs(ms: number): Date {
  return new Date(ms);
}

// O(n) in the encoded value
export function jsonText(value: unknown): string {
  return JSON.stringify(value);
}

// O(n) in the text
// INV: JSON columns are TEXT; a string is parsed once and any other value is already decoded
export function jsonValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  return JSON.parse(value);
}

// O(n)
export function stringList(value: unknown): string[] {
  const parsed = jsonValue(value);
  if (!Array.isArray(parsed)) return [];
  const out: string[] = [];
  for (const item of parsed) if (typeof item === "string") out.push(item);
  return out;
}

// O(1)
export function bitOf(value: boolean): number {
  return value ? 1 : 0;
}

// O(1)
// INV: INTEGER micros above 2^53 are not exact; callers still receive bigint
export function bigFrom(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(Math.trunc(value));
  if (typeof value === "string" && value !== "") return BigInt(value);
  return 0n;
}

// O(1)
export function utcDayOf(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

// O(1)
// INV: the server runs on the learner's machine, so its timezone is the learner's; the result is the local calendar day as YYYY-MM-DD
export function localDayOf(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// O(1)
export function dayStartMs(day: string): number {
  return Date.parse(`${day}T00:00:00.000Z`);
}

// O(1)
export function dayEndMs(day: string): number {
  return dayStartMs(day) + DAY_MS;
}

// O(1)
export function questionFrom(row: QuestionRow): QuestionRow {
  return {
    id: row.id,
    topic_id: row.topic_id,
    lesson_id: row.lesson_id,
    kind: row.kind,
    category: row.category,
    stem: row.stem,
    choices: row.choices === null ? null : jsonValue(row.choices),
    code_spec: row.code_spec === null ? null : jsonValue(row.code_spec),
    answer: jsonValue(row.answer),
    explanation: row.explanation,
    citations: jsonValue(row.citations),
  };
}
