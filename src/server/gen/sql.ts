import type { SQL } from "bun";
import type { QuestionRow } from "../learn/core.ts";
import { jsonText, questionFrom } from "../sqlmap.ts";
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
