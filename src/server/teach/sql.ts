import type { SQL } from "bun";
import type { Citation, LessonPlan } from "../../shared/api.ts";
import { sql } from "../db.ts";
import { insertQuestions } from "../gen/sql.ts";
import { CORRECT_AT, foldTopicStats, type AttemptScore, type QuestionRow } from "../learn/core.ts";
import { insertCards } from "../learn/sql.ts";
import type { Paper } from "../lit/core.ts";
import { dateFromMs, dayEndMs, dayStartMs, epochOf, jsonText, jsonValue, questionFrom, stringList, utcDayOf } from "../sqlmap.ts";
import { topicsReleasedByLesson, type TopicUse } from "../topics/core.ts";
import type { NewStep, StepContent } from "./core.ts";

export type LessonRow = { id: string; topic_id: string; title: string; plan: unknown; paper_ids: string[]; model: string; created_at: Date };
export type StepRow = { idx: number; content: unknown; question: QuestionRow };
export type MessageRow = { id: string; role: "user" | "assistant"; content: string; citations: unknown; created_at: Date };

type LessonRaw = { id: string; topic_id: string; title: string; plan: unknown; paper_ids: unknown; model: string; created_at: number };
type LessonListRaw = { id: string; title: string; created_at: number };
type PaperRaw = { id: string; doi: string | null; title: string; year: number | null; venue: string | null; abstract: string | null };
type StepJoin = QuestionRow & { idx: number; content: unknown };
type MessageRaw = { id: string | number; role: "user" | "assistant"; content: string; citations: unknown; created_at: number };

const LESSON_COLS = sql`l.id, l.topic_id, l.title, l.plan, l.paper_ids, l.model, l.created_at`;
const REPLAY_LIMIT = 100_000;

// O(1)
function lessonFrom(row: LessonRaw): LessonRow {
  return { id: row.id, topic_id: row.topic_id, title: row.title, plan: jsonValue(row.plan), paper_ids: stringList(row.paper_ids), model: row.model, created_at: dateFromMs(row.created_at) };
}

// O(1)
function stepFrom(row: StepJoin): StepRow {
  return { idx: row.idx, content: jsonValue(row.content), question: questionFrom(row) };
}

// O(1)
function messageFrom(row: MessageRaw): MessageRow {
  return { id: String(row.id), role: row.role, content: row.content, citations: jsonValue(row.citations), created_at: dateFromMs(row.created_at) };
}

// O(1)
// INV: plan and paper ids are JSON text
export async function insertLesson(tx: SQL, uid: string, topicId: string, plan: LessonPlan, paperIds: string[], model: string): Promise<string> {
  const rows: { id: string }[] = await tx`
    INSERT INTO lessons (user_id, topic_id, title, plan, paper_ids, model)
    VALUES (${uid}, ${topicId}, ${plan.title}, ${jsonText(plan)}, ${jsonText(paperIds)}, ${model}) RETURNING id`;
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

// O(limit)
// INV: served by lessons(user_id, created_at DESC)
export async function listLessons(uid: string, limit: number): Promise<{ id: string; title: string; created_at: Date }[]> {
  const rows: LessonListRaw[] = await sql`
    SELECT id, title, created_at FROM lessons
    WHERE user_id = ${uid} ORDER BY created_at DESC LIMIT ${limit}`;
  return rows.map((row) => ({ id: row.id, title: row.title, created_at: dateFromMs(row.created_at) }));
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

// O(steps), one statement
// INV: steps are joined to their question in a single query; limit 16 is the maximum stepsPerLesson
async function selectSteps(db: SQL, uid: string, lessonId: string, only: number | null): Promise<StepRow[]> {
  const rows: StepJoin[] = await db`
    SELECT s.idx, s.content, q.id, q.topic_id, q.lesson_id, q.kind, q.category, q.stem, q.choices, q.code_spec, q.answer, q.explanation, q.citations
    FROM lesson_steps s
    JOIN lessons l ON l.id = s.lesson_id
    JOIN questions q ON q.id = json_extract(s.content, '$.questionId')
    WHERE s.lesson_id = ${lessonId} AND l.user_id = ${uid} AND q.user_id = ${uid} AND (${only} IS NULL OR s.idx = ${only})
    ORDER BY s.idx LIMIT 16`;
  return rows.map(stepFrom);
}

// O(steps), one statement
export async function listSteps(uid: string, lessonId: string, only: number | null = null): Promise<StepRow[]> {
  return selectSteps(sql, uid, lessonId, only);
}

// O(1), four statements in one transaction (five when the race is lost)
// INV: checks the lesson row so a delete cannot detach the new question; SQLite serializes writers, so concurrent calls yield one step; the loser's question is deleted (its card cascades)
// INV: the winner's row is built from the RETURNING values; a loser re-reads the stored step under the same lesson transaction
// INV: null means the lesson is gone
export async function insertStep(uid: string, lesson: LessonRow, idx: number, s: NewStep): Promise<StepRow | null> {
  return sql.begin(async (tx) => {
    const held: { id: string }[] = await tx`SELECT id FROM lessons WHERE id = ${lesson.id} AND user_id = ${uid} LIMIT 1`;
    if (held.length === 0) return null;
    const [q] = await insertQuestions(tx, uid, lesson.topic_id, null, [s.check], lesson.id);
    if (!q) throw new Error("question insert returned no row");
    await insertCards(tx, uid, [q.id]);
    const content: Omit<StepContent, "citations"> & { citations: Citation[] } = { ...s.content, questionId: q.id };
    const won: { idx: number; content: unknown }[] = await tx`
      INSERT INTO lesson_steps (lesson_id, idx, content) VALUES (${lesson.id}, ${idx}, ${jsonText(content)})
      ON CONFLICT (lesson_id, idx) DO NOTHING RETURNING idx, content`;
    const mine = won[0];
    if (mine) return { idx: mine.idx, content: jsonValue(mine.content), question: q };
    await tx`DELETE FROM questions WHERE id = ${q.id} AND user_id = ${uid}`;
    const theirs = (await selectSteps(tx, uid, lesson.id, idx))[0];
    if (!theirs) throw new Error("step missing after insert");
    return theirs;
  });
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

// O(1)
// INV: both turns commit together, after the model stream succeeds
export async function insertMessagePair(uid: string, convId: string, userContent: string, assistantContent: string, citations: Citation[]): Promise<void> {
  await sql.begin(async (tx) => {
    await tx`
      INSERT INTO messages (conv_id, role, content, citations)
      SELECT c.id, 'user', ${userContent}, '[]' FROM conversations c WHERE c.id = ${convId} AND c.user_id = ${uid}`;
    await tx`
      INSERT INTO messages (conv_id, role, content, citations)
      SELECT c.id, 'assistant', ${assistantContent}, ${jsonText(citations)} FROM conversations c WHERE c.id = ${convId} AND c.user_id = ${uid}`;
  });
}

// O(limit)
// INV: served by messages(conv_id, id); newest first
export async function listMessages(uid: string, lessonId: string, before: string | null, limit: number): Promise<MessageRow[]> {
  const rows: MessageRaw[] = await sql`
    SELECT CAST(m.id AS TEXT) AS id, m.role, m.content, m.citations, m.created_at
    FROM messages m JOIN conversations c ON c.id = m.conv_id
    WHERE c.lesson_id = ${lessonId} AND c.user_id = ${uid} AND (${before} IS NULL OR m.id < CAST(${before} AS INTEGER))
    ORDER BY m.id DESC LIMIT ${limit}`;
  return rows.map(messageFrom);
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
    const qids = questions.map((q) => q.id);
    const dayRows: { day: string }[] = qids.length === 0 ? [] : await tx`
      SELECT DISTINCT strftime('%Y-%m-%d', created_at / 1000, 'unixepoch') AS day FROM attempts
      WHERE user_id = ${uid} AND question_id IN ${tx(qids)} LIMIT 4000`;
    if (dayRows.length === 4000) throw new Error("attempt day scan truncated");
    const days = dayRows.map((d) => d.day);
    const topicIds = [...new Set([lesson.topic_id, ...questions.map((q) => q.topic_id)])];
    await tx`DELETE FROM questions WHERE user_id = ${uid} AND lesson_id = ${lessonId}`;
    await tx`DELETE FROM lessons WHERE id = ${lessonId} AND user_id = ${uid}`;
    await rewriteTopicStats(tx, uid, topicIds);
    const today = utcDayOf(Date.now());
    if (days.length > 0) {
      await rewriteDays(tx, uid, days);
      await tx`DELETE FROM insights WHERE user_id = ${uid} AND (day = ${today} OR day IN ${tx(days)})`;
    } else {
      await tx`DELETE FROM insights WHERE user_id = ${uid} AND day = ${today}`;
    }
    await releaseLessonTopics(tx, uid, lesson.topic_id);
    return true;
  });
}

// O(n) in remaining attempts
async function rewriteTopicStats(tx: SQL, uid: string, topicIds: string[]): Promise<void> {
  if (topicIds.length === 0) return;
  const scored: { topic_id: string; score: number; confidence: number; created_at: number }[] = await tx`
    SELECT topic_id, score, confidence, created_at FROM attempts
    WHERE user_id = ${uid} AND topic_id IN ${tx(topicIds)} AND score IS NOT NULL AND confidence IS NOT NULL
    ORDER BY topic_id, created_at, id LIMIT ${REPLAY_LIMIT}`;
  if (scored.length === REPLAY_LIMIT) throw new Error("attempt replay truncated");
  const byTopic = new Map<string, AttemptScore[]>();
  for (const row of scored) {
    const item: AttemptScore = { score: row.score, confidence: row.confidence, createdAt: dateFromMs(row.created_at) };
    const list = byTopic.get(row.topic_id);
    if (list) list.push(item);
    else byTopic.set(row.topic_id, [item]);
  }
  const zero = topicIds.filter((id) => !byTopic.has(id));
  if (zero.length > 0) await tx`
    UPDATE topics SET attempts = 0, correct = 0, conf_err_sum = 0, mastery = 0, last_seen_at = NULL
    WHERE user_id = ${uid} AND id IN ${tx(zero)}`;
  const live = topicIds.filter((id) => byTopic.has(id));
  if (live.length === 0) return;
  const payload = jsonText(live.map((id) => {
    const stats = foldTopicStats(byTopic.get(id) ?? []);
    return { id, attempts: stats.attempts, correct: stats.correct, conf_err_sum: stats.confErrSum, mastery: stats.mastery, last_seen_at: stats.lastSeenAt === null ? null : epochOf(stats.lastSeenAt) };
  }));
  await tx`
    UPDATE topics SET attempts = CAST(json_extract(j.value, '$.attempts') AS INTEGER), correct = CAST(json_extract(j.value, '$.correct') AS INTEGER),
      conf_err_sum = json_extract(j.value, '$.conf_err_sum'), mastery = json_extract(j.value, '$.mastery'), last_seen_at = CAST(json_extract(j.value, '$.last_seen_at') AS INTEGER)
    FROM json_each(${payload}) AS j
    WHERE topics.id = json_extract(j.value, '$.id') AND topics.user_id = ${uid}`;
}

// O(attempts on the touched days)
// INV: the touched days share one sargable [min, max) range on attempts(user_id, created_at); days with no remaining attempts get no row
async function rewriteDays(tx: SQL, uid: string, days: string[]): Promise<void> {
  if (days.length === 0) return;
  let minStart = Number.POSITIVE_INFINITY;
  let maxEnd = Number.NEGATIVE_INFINITY;
  for (const day of days) {
    const start = dayStartMs(day);
    const end = dayEndMs(day);
    if (start < minStart) minStart = start;
    if (end > maxEnd) maxEnd = end;
  }
  await tx`DELETE FROM daily_activity WHERE user_id = ${uid} AND day IN ${tx(days)}`;
  await tx`
    INSERT INTO daily_activity (user_id, day, attempts, correct, reviews, review_correct, conf_err_sum)
    SELECT ${uid}, strftime('%Y-%m-%d', a.created_at / 1000, 'unixepoch'), count(*),
      count(*) FILTER (WHERE a.score >= ${CORRECT_AT}), count(*) FILTER (WHERE a.is_review = 1),
      count(*) FILTER (WHERE a.is_review = 1 AND a.score >= ${CORRECT_AT}), coalesce(sum(abs(a.confidence / 100.0 - a.score)), 0)
    FROM attempts a
    WHERE a.user_id = ${uid} AND a.created_at >= ${minStart} AND a.created_at < ${maxEnd}
      AND strftime('%Y-%m-%d', a.created_at / 1000, 'unixepoch') IN ${tx(days)}
    GROUP BY strftime('%Y-%m-%d', a.created_at / 1000, 'unixepoch')`;
}

// O(e) in edges touching the lesson topic
async function releaseLessonTopics(tx: SQL, uid: string, lessonTopicId: string): Promise<void> {
  const neighborRows: { id: string }[] = await tx`
    SELECT dst AS id FROM topic_edges WHERE user_id = ${uid} AND src = ${lessonTopicId}
    UNION SELECT src AS id FROM topic_edges WHERE user_id = ${uid} AND dst = ${lessonTopicId} LIMIT 200`;
  if (neighborRows.length === 200) throw new Error("neighbor scan truncated");
  const neighborIds = neighborRows.map((r) => r.id);
  const pool = [...new Set([lessonTopicId, ...neighborIds])];
  const edgeRows: { src: string; dst: string }[] = await tx`
    SELECT src, dst FROM topic_edges WHERE user_id = ${uid} AND (src IN ${tx(pool)} OR dst IN ${tx(pool)}) LIMIT 2000`;
  if (edgeRows.length === 2000) throw new Error("edge scan truncated");
  const useRows: { id: string; lessons: number; questions: number; attempts: number }[] = await tx`
    SELECT t.id, coalesce(l.n, 0) AS lessons, coalesce(q.n, 0) AS questions, coalesce(a.n, 0) AS attempts
    FROM topics t
    LEFT JOIN (SELECT topic_id, count(*) AS n FROM lessons WHERE user_id = ${uid} AND topic_id IN ${tx(pool)} GROUP BY topic_id) l ON l.topic_id = t.id
    LEFT JOIN (SELECT topic_id, count(*) AS n FROM questions WHERE user_id = ${uid} AND topic_id IN ${tx(pool)} GROUP BY topic_id) q ON q.topic_id = t.id
    LEFT JOIN (SELECT topic_id, count(*) AS n FROM attempts WHERE user_id = ${uid} AND topic_id IN ${tx(pool)} GROUP BY topic_id) a ON a.topic_id = t.id
    WHERE t.user_id = ${uid} AND t.id IN ${tx(pool)} LIMIT 201`;
  const useOf = new Map<string, TopicUse>(useRows.map((r) => [r.id, { lessons: r.lessons, questions: r.questions, attempts: r.attempts }]));
  const drop = topicsReleasedByLesson(lessonTopicId, neighborIds, useOf, edgeRows);
  if (drop.length === 0) return;
  await tx`
    DELETE FROM topics WHERE user_id = ${uid} AND id IN ${tx(drop)}
    AND NOT EXISTS (SELECT 1 FROM lessons l WHERE l.user_id = ${uid} AND l.topic_id = topics.id)
    AND NOT EXISTS (SELECT 1 FROM questions q WHERE q.user_id = ${uid} AND q.topic_id = topics.id)
    AND NOT EXISTS (SELECT 1 FROM attempts a WHERE a.user_id = ${uid} AND a.topic_id = topics.id)`;
}
