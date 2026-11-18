import type { SQL } from "bun";
import { sql } from "../db.ts";
import type { QuestionRow } from "../learn/core.ts";
import { attemptDaysOf, settleRemoval } from "../learn/removal.ts";
import { dateFromMs, jsonText, questionFrom } from "../sqlmap.ts";
import type { NewQuestion } from "./core.ts";

// O(k) in one statement
// INV: JSON columns are stored as text produced by json_extract, then parsed before they leave this function
export async function insertQuestions(tx: SQL, uid: string, topicId: string, styleId: string | null, qs: NewQuestion[], lessonId: string | null = null): Promise<QuestionRow[]> {
  if (qs.length === 0) return [];
  const payload = jsonText(qs.map((q) => ({ kind: q.kind, category: q.category, stem: q.stem, choices: q.choices, code_spec: q.code, answer: q.answer, explanation: q.explanation, citations: q.citations })));
  const rows: QuestionRow[] = await tx`
    INSERT INTO questions (user_id, topic_id, lesson_id, style_id, kind, category, stem, choices, code_spec, answer, explanation, citations)
    SELECT ${uid}, ${topicId}, ${lessonId}, ${styleId},
      json_extract(j.value, '$.kind'), json_extract(j.value, '$.category'), json_extract(j.value, '$.stem'),
      json_extract(j.value, '$.choices'), json_extract(j.value, '$.code_spec'), json_extract(j.value, '$.answer'),
      json_extract(j.value, '$.explanation'), json_extract(j.value, '$.citations')
    FROM json_each(${payload}) AS j
    RETURNING id, topic_id, lesson_id, kind, category, stem, choices, code_spec, answer, explanation, citations`;
  return rows.map(questionFrom);
}

export type PracticeSetRow = { id: string; topic_id: string; topic: string; request: string; style_id: string | null; created_at: Date; questions: number; answered: number };
type PracticeSetRaw = Omit<PracticeSetRow, "created_at"> & { created_at: number };

// O(1) plus k membership rows
export async function insertPracticeSet(tx: SQL, uid: string, topicId: string, styleId: string | null, request: string, questionIds: readonly string[]): Promise<string> {
  const rows: { id: string }[] = await tx`
    INSERT INTO practice_sets (user_id, topic_id, style_id, request) VALUES (${uid}, ${topicId}, ${styleId}, ${request.slice(0, 120)}) RETURNING id`;
  const id = rows[0]?.id;
  if (!id) throw new Error("practice set insert returned no row");
  if (questionIds.length > 0) await tx`
    INSERT INTO practice_set_questions (question_id, set_id)
    SELECT j.value, ${id} FROM json_each(${jsonText(questionIds)}) AS j`;
  return id;
}

// O(sets + their questions) for this user
// INV: newest first
export async function listPracticeSets(uid: string, limit: number): Promise<PracticeSetRow[]> {
  const rows: PracticeSetRaw[] = await sql`
    SELECT s.id, s.topic_id, t.name AS topic, s.request, s.style_id, s.created_at,
      (SELECT count(*) FROM practice_set_questions m WHERE m.set_id = s.id) AS questions,
      (SELECT count(*) FROM practice_set_questions m WHERE m.set_id = s.id AND EXISTS (SELECT 1 FROM attempts a WHERE a.user_id = ${uid} AND a.question_id = m.question_id)) AS answered
    FROM practice_sets s JOIN topics t ON t.id = s.topic_id
    WHERE s.user_id = ${uid}
    ORDER BY s.created_at DESC, s.id LIMIT ${limit}`;
  return rows.map((r) => ({ ...r, questions: Number(r.questions), answered: Number(r.answered), created_at: dateFromMs(r.created_at) }));
}

// O(1)
// SEC: uid is the session user; another user's set is not found
export async function findPracticeSet(uid: string, id: string): Promise<{ id: string; request: string; style_id: string | null } | null> {
  const rows: { id: string; request: string; style_id: string | null }[] = await sql`
    SELECT id, request, style_id FROM practice_sets WHERE id = ${id} AND user_id = ${uid} LIMIT 1`;
  return rows[0] ?? null;
}

// O(n) in the set's attempts
// INV: the set's questions go with it (their cards, attempts and new-card records cascade), then progress is rebuilt from what remains
// SEC: uid is the session user; a missing or foreign set deletes nothing and returns false
export async function removePracticeSet(tx: SQL, uid: string, setId: string): Promise<boolean> {
  const sets: { topic_id: string }[] = await tx`SELECT topic_id FROM practice_sets WHERE id = ${setId} AND user_id = ${uid} LIMIT 1`;
  const set = sets[0];
  if (!set) return false;
  const questions: { id: string; topic_id: string }[] = await tx`
    SELECT q.id, q.topic_id FROM practice_set_questions m JOIN questions q ON q.id = m.question_id
    WHERE m.set_id = ${setId} AND q.user_id = ${uid} LIMIT 100`;
  if (questions.length === 100) throw new Error("practice set question scan truncated");
  const qids = questions.map((q) => q.id);
  const days = await attemptDaysOf(tx, uid, qids);
  if (qids.length > 0) await tx`DELETE FROM questions WHERE user_id = ${uid} AND id IN ${tx(qids)}`;
  await tx`DELETE FROM practice_sets WHERE id = ${setId} AND user_id = ${uid}`;
  await settleRemoval(tx, uid, set.topic_id, [...new Set([set.topic_id, ...questions.map((q) => q.topic_id)])], days);
  return true;
}

// O(n) in the set's attempts
export async function deletePracticeSet(uid: string, setId: string): Promise<boolean> {
  return sql.begin((tx) => removePracticeSet(tx, uid, setId));
}
