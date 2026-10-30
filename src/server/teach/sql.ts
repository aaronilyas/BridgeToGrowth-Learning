import type { SQL } from "bun";
import type { Citation, LessonPlan } from "../../shared/api.ts";
import { sql } from "../db.ts";
import { insertQuestions } from "../gen/sql.ts";
import type { QuestionRow } from "../learn/core.ts";
import { insertCards } from "../learn/sql.ts";
import type { Paper } from "../lit/core.ts";
import type { NewStep, StepContent } from "./core.ts";

export type LessonRow = { id: string; topic_id: string; title: string; plan: unknown; paper_ids: string[]; model: string; created_at: Date };
export type StepRow = { idx: number; content: unknown; question: QuestionRow };
export type MessageRow = { id: string; role: "user" | "assistant"; content: string; citations: unknown; created_at: Date };

const LESSON_COLS = sql`l.id, l.topic_id, l.title, l.plan, l.paper_ids, l.model, l.created_at`;

// O(1)
// INV: JSON is written as text then cast
export async function insertLesson(tx: SQL, uid: string, topicId: string, plan: LessonPlan, paperIds: string[], model: string): Promise<string> {
  const rows: { id: string }[] = await tx`
    INSERT INTO lessons (user_id, topic_id, title, plan, paper_ids, model)
    VALUES (${uid}, ${topicId}, ${plan.title}, ${JSON.stringify(plan)}::text::jsonb, ${paperIds}, ${model}) RETURNING id`;
  const row = rows[0];
  if (!row) throw new Error("lesson insert returned no row");
  return row.id;
}

// O(log n)
export async function findLesson(uid: string, id: string): Promise<LessonRow | null> {
  const rows: LessonRow[] = await sql`SELECT ${LESSON_COLS} FROM lessons l WHERE l.id = ${id} AND l.user_id = ${uid} LIMIT 1`;
  return rows[0] ?? null;
}

// O(limit)
// INV: served by lessons(user_id, created_at DESC)
export async function listLessons(uid: string, limit: number): Promise<{ id: string; title: string; created_at: Date }[]> {
  return sql`SELECT id, title, created_at FROM lessons WHERE user_id = ${uid} ORDER BY created_at DESC LIMIT ${limit}`;
}

// O(k)
export async function listPapers(ids: string[]): Promise<Paper[]> {
  if (ids.length === 0) return [];
  const rows: { id: string; doi: string | null; title: string; year: number | null; venue: string | null; abstract: string | null }[] = await sql`SELECT id, doi, title, year, venue, abstract FROM papers WHERE id = ANY(${ids}) LIMIT 8`;
  const byId = new Map(rows.map((p) => [p.id, p]));
  const out: Paper[] = [];
  for (const id of ids) {
    const p = byId.get(id);
    if (p) out.push({ id: p.id, doi: p.doi, title: p.title, year: p.year, venue: p.venue, abstract: p.abstract ?? "" });
  }
  return out;
}

// O(steps), one statement
// INV: steps are joined to their question in a single query; limit 8 is the maximum stepsPerLesson
export async function listSteps(uid: string, lessonId: string, only: number | null = null): Promise<StepRow[]> {
  const rows: (QuestionRow & { idx: number; content: unknown })[] = await sql`
    SELECT s.idx, s.content, q.id, q.topic_id, q.lesson_id, q.kind, q.stem, q.choices, q.answer, q.explanation, q.citations
    FROM lesson_steps s
    JOIN lessons l ON l.id = s.lesson_id
    JOIN questions q ON q.id = (s.content->>'questionId')::uuid
    WHERE s.lesson_id = ${lessonId} AND l.user_id = ${uid} AND q.user_id = ${uid} AND (${only}::int IS NULL OR s.idx = ${only}::int)
    ORDER BY s.idx LIMIT 8`;
  return rows.map((r) => ({ idx: r.idx, content: r.content, question: r }));
}

// O(1), three statements in one transaction
// INV: concurrent calls yield one step; the loser's question is deleted (its card cascades) so no orphan remains
export async function insertStep(uid: string, lesson: LessonRow, idx: number, s: NewStep): Promise<void> {
  await sql.begin(async (tx) => {
    const [q] = await insertQuestions(tx, uid, lesson.topic_id, null, [s.check], lesson.id);
    if (!q) throw new Error("question insert returned no row");
    await insertCards(tx, uid, [q.id]);
    const content: Omit<StepContent, "citations"> & { citations: Citation[] } = { ...s.content, questionId: q.id };
    const won: { idx: number }[] = await tx`
      INSERT INTO lesson_steps (lesson_id, idx, content) VALUES (${lesson.id}, ${idx}, ${JSON.stringify(content)}::text::jsonb)
      ON CONFLICT (lesson_id, idx) DO NOTHING RETURNING idx`;
    if (won.length === 0) await tx`DELETE FROM questions WHERE id = ${q.id} AND user_id = ${uid}`;
  });
}

// O(1)
// INV: one conversation per lesson (unique lesson_id); the lesson was already checked as owned
export async function ensureConversation(uid: string, lessonId: string): Promise<string> {
  const rows: { id: string }[] = await sql`
    INSERT INTO conversations (user_id, lesson_id) VALUES (${uid}, ${lessonId})
    ON CONFLICT (lesson_id) DO UPDATE SET lesson_id = EXCLUDED.lesson_id WHERE conversations.user_id = ${uid} RETURNING id`;
  const row = rows[0];
  if (!row) throw new Error("conversation missing");
  return row.id;
}

// O(1)
export async function insertMessage(uid: string, convId: string, role: "user" | "assistant", content: string, citations: Citation[]): Promise<void> {
  await sql`
    INSERT INTO messages (conv_id, role, content, citations)
    SELECT c.id, ${role}, ${content}, ${JSON.stringify(citations)}::text::jsonb FROM conversations c WHERE c.id = ${convId} AND c.user_id = ${uid}`;
}

// O(limit)
// INV: served by messages(conv_id, id); newest first
export async function listMessages(uid: string, lessonId: string, before: string | null, limit: number): Promise<MessageRow[]> {
  return sql`
    SELECT m.id::text AS id, m.role, m.content, m.citations, m.created_at
    FROM messages m JOIN conversations c ON c.id = m.conv_id
    WHERE c.lesson_id = ${lessonId} AND c.user_id = ${uid} AND (${before}::bigint IS NULL OR m.id < ${before}::bigint)
    ORDER BY m.id DESC LIMIT ${limit}`;
}
