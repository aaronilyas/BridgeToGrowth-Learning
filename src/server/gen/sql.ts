import type { SQL } from "bun";
import type { QuestionRow } from "../learn/core.ts";
import type { NewQuestion } from "./core.ts";

// O(k) in one statement
// INV: JSON columns are written as text then cast, so Bun.sql never double-encodes them
export async function insertQuestions(tx: SQL, uid: string, topicId: string, styleId: string | null, qs: NewQuestion[], lessonId: string | null = null): Promise<QuestionRow[]> {
  if (qs.length === 0) return [];
  return tx`
    INSERT INTO questions (user_id, topic_id, lesson_id, style_id, kind, category, stem, choices, code_spec, answer, explanation, citations)
    SELECT ${uid}, ${topicId}, ${lessonId}::uuid, ${styleId}, q.kind, q.category, q.stem, q.choices::jsonb, q.code_spec::jsonb, q.answer::jsonb, q.explanation, q.citations::jsonb
    FROM unnest(${qs.map((q) => q.kind)}::text[], ${qs.map((q) => q.category)}::text[], ${qs.map((q) => q.stem)}::text[], ${qs.map((q) => (q.choices ? JSON.stringify(q.choices) : null))}::text[], ${qs.map((q) => (q.code ? JSON.stringify(q.code) : null))}::text[], ${qs.map((q) => JSON.stringify(q.answer))}::text[], ${qs.map((q) => q.explanation)}::text[], ${qs.map((q) => JSON.stringify(q.citations))}::text[])
      AS q(kind, category, stem, choices, code_spec, answer, explanation, citations)
    RETURNING id, topic_id, lesson_id, kind, category, stem, choices, code_spec, answer, explanation, citations`;
}
