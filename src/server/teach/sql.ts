import type { SQL } from "bun";
import type { Citation, LessonStatus } from "../../shared/api.ts";
import { sql } from "../db.ts";
import { insertQuestions } from "../gen/sql.ts";
import type { QuestionRow } from "../learn/core.ts";
import { attemptDaysOf, settleRemoval } from "../learn/removal.ts";
import { insertCards } from "../learn/sql.ts";
import type { Paper } from "../lit/core.ts";
import { dateFromMs, jsonText, jsonValue, questionFrom, stringList } from "../sqlmap.ts";
import type { NewQuestion } from "../gen/core.ts";
import { legacyStepContent, lessonStatus, planToStored, withLegacyCheckNote, type StoredPlan } from "./core.ts";

export type LessonRow = { id: string; topic_id: string; title: string; plan: unknown; paper_ids: string[]; model: string; created_at: Date };
export type MessageRow = { id: string; role: "user" | "assistant"; content: string; citations: unknown; created_at: Date; topic_idx: number | null; check_id: string | null; finishes: boolean };
// INV: learnerTopicIdx is the topic the learner replied on; topic is the outline entry the turn ended on, null if the plan has no such entry
export type NewTurn = { user: string | null; content: string; citations: Citation[]; topicIdx: number; learnerTopicIdx: number; topic: { title: string; summary: string } | null; finishes: boolean; check: NewQuestion | null };
export type LessonListRow = { id: string; title: string; created_at: Date; status: LessonStatus; last_active_at: Date };

type LessonRaw = { id: string; topic_id: string; title: string; plan: unknown; paper_ids: unknown; model: string; created_at: number };
type LessonListRaw = { id: string; title: string; created_at: number; newest_attempted: number | null; finished: number; last_active: number };
type PaperRaw = { id: string; doi: string | null; title: string; year: number | null; venue: string | null; abstract: string | null };
type MessageRaw = { id: string | number; role: "user" | "assistant"; content: string; citations: unknown; created_at: number; topic_idx: number | null; check_id: string | null; finishes: number };

const LESSON_COLS = sql`l.id, l.topic_id, l.title, l.plan, l.paper_ids, l.model, l.created_at`;
const QUESTION_COLS = sql`q.id, q.topic_id, q.lesson_id, q.kind, q.category, q.stem, q.choices, q.code_spec, q.answer, q.explanation, q.citations`;

// O(1)
function lessonFrom(row: LessonRaw): LessonRow {
  return { id: row.id, topic_id: row.topic_id, title: row.title, plan: jsonValue(row.plan), paper_ids: stringList(row.paper_ids), model: row.model, created_at: dateFromMs(row.created_at) };
}

// O(1)
function messageFrom(row: MessageRaw): MessageRow {
  return { id: String(row.id), role: row.role, content: row.content, citations: jsonValue(row.citations), created_at: dateFromMs(row.created_at), topic_idx: row.topic_idx === null ? null : Number(row.topic_idx), check_id: row.check_id, finishes: Number(row.finishes) === 1 };
}

// O(1)
// INV: plan and paper ids are JSON text
export async function insertLesson(tx: SQL, uid: string, topicId: string, plan: StoredPlan, paperIds: string[], model: string): Promise<string> {
  const rows: { id: string }[] = await tx`
    INSERT INTO lessons (user_id, topic_id, title, plan, paper_ids, model)
    VALUES (${uid}, ${topicId}, ${plan.title}, ${jsonText(planToStored(plan))}, ${jsonText(paperIds)}, ${model}) RETURNING id`;
  const row = rows[0];
  if (!row) throw new Error("lesson insert returned no row");
  return row.id;
}

// O(log n)
export async function findLesson(uid: string, id: string): Promise<LessonRow | null> {
  const rows: LessonRaw[] = await sql`
    SELECT ${LESSON_COLS} FROM lessons l
    WHERE l.id = ${id} AND l.user_id = ${uid} LIMIT 1`;
  const row = rows[0];
  return row ? lessonFrom(row) : null;
}

// O(lessons for this user)
// INV: one statement; status comes from the newest check and whether the tutor closed the lesson; the page is newest activity first
export async function listLessons(uid: string, limit: number): Promise<LessonListRow[]> {
  const rows: LessonListRaw[] = await sql`
    SELECT id, title, created_at, newest_attempted, finished, last_active FROM (
      SELECT l.id AS id, l.title AS title, l.created_at AS created_at,
        (SELECT CASE WHEN EXISTS (SELECT 1 FROM attempts a WHERE a.user_id = ${uid} AND a.question_id = m.check_id) THEN 1 ELSE 0 END FROM lesson_turns m JOIN conversations c ON c.id = m.conv_id WHERE c.lesson_id = l.id AND c.user_id = ${uid} AND m.check_id IS NOT NULL ORDER BY m.id DESC LIMIT 1) AS newest_attempted,
        EXISTS (SELECT 1 FROM lesson_turns m JOIN conversations c ON c.id = m.conv_id WHERE c.lesson_id = l.id AND c.user_id = ${uid} AND m.finishes = 1) AS finished,
        max(l.created_at, coalesce((SELECT max(m.created_at) FROM lesson_turns m JOIN conversations c ON c.id = m.conv_id WHERE c.lesson_id = l.id AND c.user_id = ${uid}), 0), coalesce((SELECT max(a.created_at) FROM attempts a JOIN questions q ON q.id = a.question_id WHERE a.user_id = ${uid} AND q.user_id = ${uid} AND q.lesson_id = l.id), 0)) AS last_active
      FROM lessons l WHERE l.user_id = ${uid}
    ) AS listed ORDER BY last_active DESC LIMIT ${limit}`;
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    created_at: dateFromMs(row.created_at),
    status: lessonStatus({ newestAttempted: row.newest_attempted === null ? null : Number(row.newest_attempted) === 1, finished: Number(row.finished) === 1 }),
    last_active_at: dateFromMs(Number(row.last_active)),
  }));
}

// O(k)
export async function listPapers(ids: string[]): Promise<Paper[]> {
  if (ids.length === 0) return [];
  const rows: PaperRaw[] = await sql`SELECT id, doi, title, year, venue, abstract FROM papers WHERE id IN ${sql(ids)} LIMIT 8`;
  const byId = new Map(rows.map((p) => [p.id, p]));
  const out: Paper[] = [];
  for (const id of ids) {
    const p = byId.get(id);
    if (p) out.push({ id: p.id, doi: p.doi, title: p.title, year: p.year, venue: p.venue, abstract: p.abstract ?? "" });
  }
  return out;
}

// O(1)
// INV: one conversation per lesson (unique lesson_id); the lesson was already checked as owned
export async function ensureConversation(uid: string, lessonId: string): Promise<string> {
  const rows: { id: string }[] = await sql`
    INSERT INTO conversations (user_id, lesson_id) VALUES (${uid}, ${lessonId})
    ON CONFLICT (lesson_id) DO UPDATE SET lesson_id = excluded.lesson_id WHERE conversations.user_id = ${uid} RETURNING id`;
  const row = rows[0];
  if (!row) throw new Error("conversation missing");
  return row.id;
}

// O(1), up to nine statements in one transaction
// INV: checks the lesson row so a delete cannot detach the new question; the check, its card and every written row commit together, after the model has finished
// INV: an opening turn (user null) is stored only into an empty conversation, so a duplicate request cannot write a second one
// INV: returns the stored check, or null when the turn carried none or could not be stored
// INV: each turn is also written in v0.1.1's form, because v0.1.1 cannot read lesson_turns; the links stop the next start from importing these rows back
export async function insertTutorTurn(uid: string, lesson: LessonRow, convId: string, t: NewTurn): Promise<QuestionRow | null> {
  return sql.begin(async (tx) => {
    const held: { id: string }[] = await tx`SELECT id FROM lessons WHERE id = ${lesson.id} AND user_id = ${uid} LIMIT 1`;
    if (held.length === 0) return null;
    if (t.user === null) {
      const said: { id: number }[] = await tx`SELECT id FROM lesson_turns WHERE conv_id = ${convId} LIMIT 1`;
      if (said.length > 0) return null;
    }
    let question: QuestionRow | null = null;
    let legacyStep: number | null = null;
    if (t.check) {
      const [q] = await insertQuestions(tx, uid, lesson.topic_id, null, [t.check], lesson.id);
      if (!q) throw new Error("question insert returned no row");
      await insertCards(tx, uid, [q.id]);
      question = q;
      if (t.topic) {
        const won: { idx: number }[] = await tx`
          INSERT INTO lesson_steps (lesson_id, idx, content) VALUES (${lesson.id}, ${t.topicIdx}, ${jsonText(legacyStepContent(t.topic, q.id))})
          ON CONFLICT (lesson_id, idx) DO NOTHING RETURNING idx`;
        legacyStep = won[0]?.idx ?? null;
      }
    }
    if (t.user !== null) {
      const legacy: { id: number }[] = await tx`
        INSERT INTO messages (conv_id, role, content, citations, step_idx)
        SELECT c.id, 'user', ${t.user}, '[]', ${t.learnerTopicIdx} FROM conversations c WHERE c.id = ${convId} AND c.user_id = ${uid} RETURNING id`;
      await tx`
        INSERT INTO lesson_turns (conv_id, role, content, citations, legacy_message_id)
        SELECT c.id, 'user', ${t.user}, '[]', ${legacy[0]?.id ?? null} FROM conversations c WHERE c.id = ${convId} AND c.user_id = ${uid}`;
    }
    const legacyContent = question !== null && legacyStep === null ? withLegacyCheckNote(t.content, question.stem) : t.content;
    const legacy: { id: number }[] = await tx`
      INSERT INTO messages (conv_id, role, content, citations, step_idx)
      SELECT c.id, 'assistant', ${legacyContent}, ${jsonText(t.citations)}, ${t.topicIdx} FROM conversations c WHERE c.id = ${convId} AND c.user_id = ${uid} RETURNING id`;
    await tx`
      INSERT INTO lesson_turns (conv_id, role, content, citations, topic_idx, check_id, finishes, legacy_message_id, legacy_step_idx)
      SELECT c.id, 'assistant', ${t.content}, ${jsonText(t.citations)}, ${t.topicIdx}, ${question?.id ?? null}, ${t.finishes ? 1 : 0}, ${legacy[0]?.id ?? null}, ${legacyStep} FROM conversations c WHERE c.id = ${convId} AND c.user_id = ${uid}`;
    return question;
  });
}

// O(limit)
// INV: served by lesson_turns(conv_id, id); newest first
export async function listMessages(uid: string, lessonId: string, before: string | null, limit: number): Promise<MessageRow[]> {
  const rows: MessageRaw[] = await sql`
    SELECT CAST(m.id AS TEXT) AS id, m.role, m.content, m.citations, m.created_at, m.topic_idx, m.check_id, m.finishes
    FROM lesson_turns m JOIN conversations c ON c.id = m.conv_id
    WHERE c.lesson_id = ${lessonId} AND c.user_id = ${uid} AND (${before} IS NULL OR m.id < CAST(${before} AS INTEGER))
    ORDER BY m.id DESC LIMIT ${limit}`;
  return rows.map(messageFrom);
}

// O(k) in ids
export async function listChecks(uid: string, ids: string[]): Promise<QuestionRow[]> {
  if (ids.length === 0) return [];
  const rows: QuestionRow[] = await sql`SELECT ${QUESTION_COLS} FROM questions q WHERE q.user_id = ${uid} AND q.id IN ${sql(ids)} LIMIT 500`;
  return rows.map(questionFrom);
}

// O(turns in the lesson) in the worst case; served newest first by lesson_turns(conv_id, id)
// SEC: only a check attached to this lesson can match, so a request cannot read another lesson's check through checkId
// INV: id null finds the lesson's latest check
export async function findLessonCheck(uid: string, lessonId: string, id: string | null): Promise<QuestionRow | null> {
  const rows: QuestionRow[] = await sql`
    SELECT ${QUESTION_COLS} FROM lesson_turns m
    JOIN conversations c ON c.id = m.conv_id
    JOIN questions q ON q.id = m.check_id
    WHERE c.lesson_id = ${lessonId} AND c.user_id = ${uid} AND q.user_id = ${uid} AND (${id} IS NULL OR q.id = ${id})
    ORDER BY m.id DESC LIMIT 1`;
  const row = rows[0];
  return row ? questionFrom(row) : null;
}

// O(lesson questions), served by questions_lesson_idx
export async function countLessonChecks(uid: string, lessonId: string): Promise<number> {
  const rows: { n: number }[] = await sql`SELECT count(*) AS n FROM questions WHERE user_id = ${uid} AND lesson_id = ${lessonId} LIMIT 1`;
  return Number(rows[0]?.n ?? 0);
}

// O(n) in the lesson's attempts
// INV: questions are deleted before the lesson row, so ON DELETE SET NULL cannot leave them behind
// INV: topic mastery is replayed from the attempts that remain, oldest first
// SEC: uid is the session user; a missing lesson deletes nothing and returns false
export async function deleteLessonData(uid: string, lessonId: string): Promise<boolean> {
  return sql.begin(async (tx) => {
    const locked: { id: string; topic_id: string }[] = await tx`SELECT id, topic_id FROM lessons WHERE id = ${lessonId} AND user_id = ${uid} LIMIT 1`;
    const lesson = locked[0];
    if (!lesson) return false;
    const questions: { id: string; topic_id: string }[] = await tx`
      SELECT id, topic_id FROM questions WHERE user_id = ${uid} AND lesson_id = ${lessonId} LIMIT 100`;
    if (questions.length === 100) throw new Error("lesson question scan truncated");
    const days = await attemptDaysOf(tx, uid, questions.map((q) => q.id));
    await tx`DELETE FROM questions WHERE user_id = ${uid} AND lesson_id = ${lessonId}`;
    await tx`DELETE FROM lessons WHERE id = ${lessonId} AND user_id = ${uid}`;
    await settleRemoval(tx, uid, lesson.topic_id, [...new Set([lesson.topic_id, ...questions.map((q) => q.topic_id)])], days);
    return true;
  });
}
