import type { SQL } from "bun";
import type { Citation, LessonPlan } from "../../shared/api.ts";
import { sql } from "../db.ts";
import { insertQuestions } from "../gen/sql.ts";
import { CORRECT_AT, foldTopicStats, type AttemptScore, type QuestionRow } from "../learn/core.ts";
import { insertCards } from "../learn/sql.ts";
import type { Paper } from "../lit/core.ts";
import { topicsReleasedByLesson, type TopicUse } from "../topics/core.ts";
import type { NewStep, StepContent } from "./core.ts";

export type LessonRow = { id: string; topic_id: string; title: string; plan: unknown; paper_ids: string[]; model: string; created_at: Date; expires_at: Date | null };
export type StepRow = { idx: number; content: unknown; question: QuestionRow };
export type MessageRow = { id: string; role: "user" | "assistant"; content: string; citations: unknown; created_at: Date };

const LESSON_COLS = sql`l.id, l.topic_id, l.title, l.plan, l.paper_ids, l.model, l.created_at, l.expires_at`;

// O(1)
// INV: JSON is written as text then cast; expiresAt is set for free-plan lessons only
export async function insertLesson(tx: SQL, uid: string, topicId: string, plan: LessonPlan, paperIds: string[], model: string, expiresAt: Date | null): Promise<string> {
  const rows: { id: string }[] = await tx`
    INSERT INTO lessons (user_id, topic_id, title, plan, paper_ids, model, expires_at)
    VALUES (${uid}, ${topicId}, ${plan.title}, ${JSON.stringify(plan)}::text::jsonb, ${paperIds}, ${model}, ${expiresAt}) RETURNING id`;
  const row = rows[0];
  if (!row) throw new Error("lesson insert returned no row");
  return row.id;
}

// O(log n)
// INV: an expired lesson is gone to its owner even before the sweeper deletes it
export async function findLesson(uid: string, id: string): Promise<LessonRow | null> {
  const rows: LessonRow[] = await sql`SELECT ${LESSON_COLS} FROM lessons l WHERE l.id = ${id} AND l.user_id = ${uid} AND (l.expires_at IS NULL OR l.expires_at > now()) LIMIT 1`;
  return rows[0] ?? null;
}

// O(limit)
// INV: served by lessons(user_id, created_at DESC); expired lessons are hidden
export async function listLessons(uid: string, limit: number): Promise<{ id: string; title: string; created_at: Date; expires_at: Date | null }[]> {
  return sql`SELECT id, title, created_at, expires_at FROM lessons WHERE user_id = ${uid} AND (expires_at IS NULL OR expires_at > now()) ORDER BY created_at DESC LIMIT ${limit}`;
}

// O(batch) lesson deletions, via lessons_expires_idx
// INV: each lesson goes through deleteLessonData so topic stats, daily activity and orphaned topics stay consistent; one failing lesson does not stop the rest
export async function deleteExpiredLessons(batch: number = 200): Promise<number> {
  const due: { id: string; user_id: string }[] = await sql`
    SELECT id, user_id FROM lessons WHERE expires_at IS NOT NULL AND expires_at <= now() ORDER BY expires_at LIMIT ${batch}`;
  let n = 0;
  for (const l of due) {
    try {
      if (await deleteLessonData(l.user_id, l.id)) n++;
    } catch {
      console.error("teach: expired lesson delete failed");
    }
  }
  return n;
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
// INV: steps are joined to their question in a single query; limit 16 is the maximum stepsPerLesson
async function selectSteps(db: SQL, uid: string, lessonId: string, only: number | null): Promise<StepRow[]> {
  const rows: (QuestionRow & { idx: number; content: unknown })[] = await db`
    SELECT s.idx, s.content, q.id, q.topic_id, q.lesson_id, q.kind, q.category, q.stem, q.choices, q.code_spec, q.answer, q.explanation, q.citations
    FROM lesson_steps s
    JOIN lessons l ON l.id = s.lesson_id
    JOIN questions q ON q.id = (s.content->>'questionId')::uuid
    WHERE s.lesson_id = ${lessonId} AND l.user_id = ${uid} AND q.user_id = ${uid} AND (${only}::int IS NULL OR s.idx = ${only}::int)
    ORDER BY s.idx LIMIT 16`;
  return rows.map((r) => ({ idx: r.idx, content: r.content, question: r }));
}

// O(steps), one statement
export async function listSteps(uid: string, lessonId: string, only: number | null = null): Promise<StepRow[]> {
  return selectSteps(sql, uid, lessonId, only);
}

// O(1), four statements in one transaction (five when the race is lost)
// INV: locks the lesson row so a delete cannot detach the new question; concurrent calls yield one step; the loser's question is deleted (its card cascades)
// INV: the winner's row is built from the RETURNING values; a loser re-reads the stored step under the same lesson lock, which serialises every insertStep for the lesson, so the winner has committed
// INV: null means the lesson is gone
export async function insertStep(uid: string, lesson: LessonRow, idx: number, s: NewStep): Promise<StepRow | null> {
  return sql.begin(async (tx) => {
    const held: { id: string }[] = await tx`SELECT id FROM lessons WHERE id = ${lesson.id} AND user_id = ${uid} FOR UPDATE`;
    if (held.length === 0) return null;
    const [q] = await insertQuestions(tx, uid, lesson.topic_id, null, [s.check], lesson.id);
    if (!q) throw new Error("question insert returned no row");
    await insertCards(tx, uid, [q.id]);
    const content: Omit<StepContent, "citations"> & { citations: Citation[] } = { ...s.content, questionId: q.id };
    const won: { idx: number; content: unknown }[] = await tx`
      INSERT INTO lesson_steps (lesson_id, idx, content) VALUES (${lesson.id}, ${idx}, ${JSON.stringify(content)}::text::jsonb)
      ON CONFLICT (lesson_id, idx) DO NOTHING RETURNING idx, content`;
    const mine = won[0];
    if (mine) return { idx: mine.idx, content: mine.content, question: q };
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
    ON CONFLICT (lesson_id) DO UPDATE SET lesson_id = EXCLUDED.lesson_id WHERE conversations.user_id = ${uid} RETURNING id`;
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
      SELECT c.id, 'user', ${userContent}, '[]'::jsonb FROM conversations c WHERE c.id = ${convId} AND c.user_id = ${uid}`;
    await tx`
      INSERT INTO messages (conv_id, role, content, citations)
      SELECT c.id, 'assistant', ${assistantContent}, ${JSON.stringify(citations)}::text::jsonb FROM conversations c WHERE c.id = ${convId} AND c.user_id = ${uid}`;
  });
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

const REPLAY_LIMIT = 100_000;

// O(n) in the lesson's attempts
// INV: questions are deleted before the lesson row, so ON DELETE SET NULL cannot leave them behind
// INV: topic mastery is replayed from the attempts that remain, oldest first
// SEC: uid is the session user (or the owner, for the expiry sweeper); a missing lesson deletes nothing and returns false
export async function deleteLessonData(uid: string, lessonId: string): Promise<boolean> {
  return sql.begin(async (tx) => {
    const locked: { id: string; topic_id: string }[] = await tx`SELECT id, topic_id FROM lessons WHERE id = ${lessonId} AND user_id = ${uid} FOR UPDATE`;
    const lesson = locked[0];
    if (!lesson) return false;
    const questions: { id: string; topic_id: string }[] = await tx`
      SELECT id, topic_id FROM questions WHERE user_id = ${uid} AND lesson_id = ${lessonId} LIMIT 100`;
    if (questions.length === 100) throw new Error("lesson question scan truncated");
    const qids = questions.map((q) => q.id);
    const dayRows: { day: string }[] = qids.length === 0 ? [] : await tx`
      SELECT DISTINCT (created_at AT TIME ZONE 'UTC')::date::text AS day FROM attempts
      WHERE user_id = ${uid} AND question_id = ANY(${qids}::uuid[]) LIMIT 4000`;
    if (dayRows.length === 4000) throw new Error("attempt day scan truncated");
    const days = dayRows.map((d) => d.day);
    const topicIds = [...new Set([lesson.topic_id, ...questions.map((q) => q.topic_id)])];
    await tx`SELECT id FROM topics WHERE user_id = ${uid} AND id = ANY(${topicIds}::uuid[]) FOR UPDATE`;
    await tx`DELETE FROM questions WHERE user_id = ${uid} AND lesson_id = ${lessonId}`;
    await tx`DELETE FROM lessons WHERE id = ${lessonId} AND user_id = ${uid}`;
    await rewriteTopicStats(tx, uid, topicIds);
    if (days.length > 0) {
      await rewriteDays(tx, uid, days);
      await tx`DELETE FROM insights WHERE user_id = ${uid} AND (day = (now() AT TIME ZONE 'UTC')::date OR day = ANY(${days}::date[]))`;
    } else {
      await tx`DELETE FROM insights WHERE user_id = ${uid} AND day = (now() AT TIME ZONE 'UTC')::date`;
    }
    await releaseLessonTopics(tx, uid, lesson.topic_id);
    return true;
  });
}

// O(n) in remaining attempts
async function rewriteTopicStats(tx: SQL, uid: string, topicIds: string[]): Promise<void> {
  const scored: { topic_id: string; score: number; confidence: number; created_at: Date }[] = await tx`
    SELECT topic_id, score, confidence, created_at FROM attempts
    WHERE user_id = ${uid} AND topic_id = ANY(${topicIds}::uuid[]) AND score IS NOT NULL AND confidence IS NOT NULL
    ORDER BY topic_id, created_at, id LIMIT ${REPLAY_LIMIT}`;
  if (scored.length === REPLAY_LIMIT) throw new Error("attempt replay truncated");
  const byTopic = new Map<string, AttemptScore[]>();
  for (const row of scored) {
    const item: AttemptScore = { score: row.score, confidence: row.confidence, createdAt: row.created_at };
    const list = byTopic.get(row.topic_id);
    if (list) list.push(item);
    else byTopic.set(row.topic_id, [item]);
  }
  const zero = topicIds.filter((id) => !byTopic.has(id));
  if (zero.length > 0) await tx`
    UPDATE topics SET attempts = 0, correct = 0, conf_err_sum = 0, mastery = 0, last_seen_at = NULL
    WHERE user_id = ${uid} AND id = ANY(${zero}::uuid[])`;
  const live = topicIds.filter((id) => byTopic.has(id));
  if (live.length === 0) return;
  const stats = live.map((id) => foldTopicStats(byTopic.get(id) ?? []));
  await tx`
    UPDATE topics t SET attempts = v.attempts, correct = v.correct, conf_err_sum = v.conf_err_sum, mastery = v.mastery, last_seen_at = v.last_seen_at
    FROM unnest(
      ${live}::uuid[], ${stats.map((s) => s.attempts)}::int[], ${stats.map((s) => s.correct)}::int[],
      ${stats.map((s) => s.confErrSum)}::float8[], ${stats.map((s) => s.mastery)}::float8[], ${stats.map((s) => s.lastSeenAt)}::timestamptz[]
    ) AS v(id, attempts, correct, conf_err_sum, mastery, last_seen_at)
    WHERE t.id = v.id AND t.user_id = ${uid}`;
}

// O(attempts on the touched days)
// INV: each day is a sargable [d, d+1) UTC range on attempts(user_id, created_at DESC), evaluated per day through LATERAL; a plain JOIN lets the planner join-filter every attempt against every day
// INV: days are deduplicated, and a day with no remaining attempts gets no row, as with the former GROUP BY
async function rewriteDays(tx: SQL, uid: string, days: string[]): Promise<void> {
  await tx`DELETE FROM daily_activity WHERE user_id = ${uid} AND day = ANY(${days}::date[])`;
  await tx`
    INSERT INTO daily_activity (user_id, day, attempts, correct, reviews, review_correct, conf_err_sum)
    SELECT ${uid}, d.day, s.attempts, s.correct, s.reviews, s.review_correct, s.conf_err_sum
    FROM (SELECT DISTINCT unnest(${days}::date[]) AS day) d
    CROSS JOIN LATERAL (
      SELECT count(*)::int AS attempts, count(*) FILTER (WHERE a.score >= ${CORRECT_AT})::int AS correct,
        count(*) FILTER (WHERE a.is_review)::int AS reviews, count(*) FILTER (WHERE a.is_review AND a.score >= ${CORRECT_AT})::int AS review_correct,
        coalesce(sum(abs(a.confidence / 100.0 - a.score)), 0) AS conf_err_sum
      FROM attempts a
      WHERE a.user_id = ${uid} AND a.created_at >= d.day::timestamp AT TIME ZONE 'UTC' AND a.created_at < (d.day + 1)::timestamp AT TIME ZONE 'UTC'
    ) s
    WHERE s.attempts > 0`;
}

// O(e) in edges touching the lesson topic
async function releaseLessonTopics(tx: SQL, uid: string, lessonTopicId: string): Promise<void> {
  const neighborRows: { id: string }[] = await tx`
    SELECT dst AS id FROM topic_edges WHERE user_id = ${uid} AND src = ${lessonTopicId}
    UNION SELECT src AS id FROM topic_edges WHERE user_id = ${uid} AND dst = ${lessonTopicId} LIMIT 200`;
  if (neighborRows.length === 200) throw new Error("neighbor scan truncated");
  const neighborIds = neighborRows.map((r) => r.id);
  const pool = [...new Set([lessonTopicId, ...neighborIds])];
  await tx`SELECT id FROM topics WHERE user_id = ${uid} AND id = ANY(${pool}::uuid[]) FOR UPDATE`;
  const edgeRows: { src: string; dst: string }[] = await tx`
    SELECT src, dst FROM topic_edges WHERE user_id = ${uid} AND (src = ANY(${pool}::uuid[]) OR dst = ANY(${pool}::uuid[])) LIMIT 2000`;
  if (edgeRows.length === 2000) throw new Error("edge scan truncated");
  const useRows: { id: string; lessons: number; questions: number; attempts: number }[] = await tx`
    SELECT t.id, coalesce(l.n, 0)::int AS lessons, coalesce(q.n, 0)::int AS questions, coalesce(a.n, 0)::int AS attempts
    FROM topics t
    LEFT JOIN (SELECT topic_id, count(*)::int AS n FROM lessons WHERE user_id = ${uid} AND topic_id = ANY(${pool}::uuid[]) GROUP BY topic_id) l ON l.topic_id = t.id
    LEFT JOIN (SELECT topic_id, count(*)::int AS n FROM questions WHERE user_id = ${uid} AND topic_id = ANY(${pool}::uuid[]) GROUP BY topic_id) q ON q.topic_id = t.id
    LEFT JOIN (SELECT topic_id, count(*)::int AS n FROM attempts WHERE user_id = ${uid} AND topic_id = ANY(${pool}::uuid[]) GROUP BY topic_id) a ON a.topic_id = t.id
    WHERE t.user_id = ${uid} AND t.id = ANY(${pool}::uuid[]) LIMIT 201`;
  const useOf = new Map<string, TopicUse>(useRows.map((r) => [r.id, { lessons: r.lessons, questions: r.questions, attempts: r.attempts }]));
  const drop = topicsReleasedByLesson(lessonTopicId, neighborIds, useOf, edgeRows);
  if (drop.length === 0) return;
  await tx`
    DELETE FROM topics t WHERE t.user_id = ${uid} AND t.id = ANY(${drop}::uuid[])
    AND NOT EXISTS (SELECT 1 FROM lessons l WHERE l.user_id = ${uid} AND l.topic_id = t.id)
    AND NOT EXISTS (SELECT 1 FROM questions q WHERE q.user_id = ${uid} AND q.topic_id = t.id)
    AND NOT EXISTS (SELECT 1 FROM attempts a WHERE a.user_id = ${uid} AND a.topic_id = t.id)`;
}
