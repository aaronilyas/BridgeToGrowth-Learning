import type { SQL } from "bun";
import { CORRECT_AT, foldTopicStats, type AttemptScore } from "./core.ts";
import { dateFromMs, dayEndMs, dayStartMs, epochOf, jsonText, utcDayOf } from "../sqlmap.ts";
import { topicsReleasedByLesson, type TopicUse } from "../topics/core.ts";

// Shared by everything that deletes questions a learner may have answered (a lesson, a practice set): the derived progress is rebuilt from what remains.

const REPLAY_LIMIT = 100_000;

// O(attempts on the questions)
// INV: call before the questions are deleted; the UTC days their attempts fell on
export async function attemptDaysOf(tx: SQL, uid: string, questionIds: readonly string[]): Promise<string[]> {
  if (questionIds.length === 0) return [];
  const rows: { day: string }[] = await tx`
    SELECT DISTINCT strftime('%Y-%m-%d', created_at / 1000, 'unixepoch') AS day FROM attempts
    WHERE user_id = ${uid} AND question_id IN ${tx(questionIds)} LIMIT 4000`;
  if (rows.length === 4000) throw new Error("attempt day scan truncated");
  return rows.map((d) => d.day);
}

// O(n) in the remaining attempts of the touched topics and days
// INV: call after the questions (and their owner row) are deleted, in the same transaction
// INV: topic mastery is replayed from the attempts that remain, oldest first; touched days and their insights are rebuilt; topics nothing uses any more around anchorTopicId are dropped
export async function settleRemoval(tx: SQL, uid: string, anchorTopicId: string, topicIds: readonly string[], days: readonly string[]): Promise<void> {
  await rewriteTopicStats(tx, uid, [...topicIds]);
  const today = utcDayOf(Date.now());
  if (days.length > 0) {
    await rewriteDays(tx, uid, [...days]);
    await tx`DELETE FROM insights WHERE user_id = ${uid} AND (day = ${today} OR day IN ${tx(days)})`;
  } else {
    await tx`DELETE FROM insights WHERE user_id = ${uid} AND day = ${today}`;
  }
  await releaseTopics(tx, uid, anchorTopicId);
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
async function releaseTopics(tx: SQL, uid: string, lessonTopicId: string): Promise<void> {
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
