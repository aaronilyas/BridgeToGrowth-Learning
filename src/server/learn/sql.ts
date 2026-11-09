import type { SQL } from "bun";
import type { Settings } from "../../shared/settings.ts";
import { sql } from "../db.ts";
import { bitOf, dateFromMs, epochOf, jsonText, jsonValue, localDayOf, questionFrom, utcDayOf } from "../sqlmap.ts";
import { CORRECT_AT, isRetired, nextMastery, qualityOf, scheduleSm2, settingsToStored, type Card, type QuestionRow } from "./core.ts";

export type AttemptIn = { uid: string; topicId: string; questionId: string; lessonId: string | null; score: number; confidence: number; latencyMs: number; response: string | null; dontKnow: boolean; srs: { enabled: boolean; repetitions: number } };
export type LatestAttempt = { questionId: string; score: number; confidence: number | null; dontKnow: boolean; response: string | null };
type CardRow = { ef: number; interval_d: number; reps: number; lapses: number; due_at: number };

const QUESTION_COLS = sql`q.id, q.topic_id, q.lesson_id, q.kind, q.category, q.stem, q.choices, q.code_spec, q.answer, q.explanation, q.citations`;

// O(log n)
export async function findQuestion(uid: string, id: string): Promise<QuestionRow | null> {
  const rows: QuestionRow[] = await sql`SELECT ${QUESTION_COLS} FROM questions q WHERE q.id = ${id} AND q.user_id = ${uid} LIMIT 1`;
  const row = rows[0];
  return row ? questionFrom(row) : null;
}

// O(log n)
export async function countReviewsToday(uid: string): Promise<number> {
  const rows: { reviews: number }[] = await sql`SELECT reviews FROM daily_activity WHERE user_id = ${uid} AND day = ${utcDayOf(Date.now())} LIMIT 1`;
  return rows[0]?.reviews ?? 0;
}

// O(due cards)
// INV: a review is a due card with at least one attempt; a failed card has reps 0 but is still a review; due_at order; retired cards (reps > repetitions) are skipped
export async function listDueReviews(uid: string, limit: number, repetitions: number, now: number): Promise<QuestionRow[]> {
  const rows: QuestionRow[] = await sql`
    SELECT ${QUESTION_COLS} FROM cards c JOIN questions q ON q.id = c.question_id
    WHERE c.user_id = ${uid} AND q.user_id = ${uid} AND c.due_at <= ${now} AND c.reps <= ${repetitions}
      AND EXISTS (SELECT 1 FROM attempts a WHERE a.user_id = ${uid} AND a.question_id = c.question_id)
    ORDER BY c.due_at LIMIT ${limit}`;
  return rows.map(questionFrom);
}

// O(due cards)
// INV: a new card has never been attempted; oldest first, and a set generated together keeps its insertion order
export async function listNewQuestions(uid: string, limit: number, now: number): Promise<QuestionRow[]> {
  const rows: QuestionRow[] = await sql`
    SELECT ${QUESTION_COLS} FROM cards c JOIN questions q ON q.id = c.question_id
    WHERE c.user_id = ${uid} AND q.user_id = ${uid} AND c.due_at <= ${now}
      AND NOT EXISTS (SELECT 1 FROM attempts a WHERE a.user_id = ${uid} AND a.question_id = c.question_id)
    ORDER BY q.created_at, q.rowid LIMIT ${limit}`;
  return rows.map(questionFrom);
}

// O(served today)
// INV: a question served as new and still unanswered is served again and does not count, so reloading the queue spends nothing
export async function countNewCardsAnswered(uid: string, day: string): Promise<number> {
  const rows: { n: number }[] = await sql`
    SELECT count(*) AS n FROM new_card_intros i
    WHERE i.user_id = ${uid} AND i.day = ${day} AND EXISTS (SELECT 1 FROM attempts a WHERE a.user_id = ${uid} AND a.question_id = i.question_id)`;
  return Number(rows[0]?.n ?? 0);
}

// O(k) in one statement
// INV: only an unanswered question reaches here, so day moves forward until the question is answered and then stays
export async function markNewCardsServed(uid: string, day: string, questionIds: string[]): Promise<void> {
  if (questionIds.length === 0) return;
  await sql`
    INSERT INTO new_card_intros (question_id, user_id, day)
    SELECT j.value, ${uid}, ${day} FROM json_each(${jsonText(questionIds)}) AS j
    WHERE true
    ON CONFLICT (question_id) DO UPDATE SET day = excluded.day`;
}

// O(k) in one statement
// INV: new cards are due immediately; idempotent per question
// INV: WHERE true stops SQLite from parsing ON CONFLICT as a join
export async function insertCards(tx: SQL, uid: string, questionIds: string[]): Promise<void> {
  if (questionIds.length === 0) return;
  await tx`
    INSERT INTO cards (question_id, user_id)
    SELECT j.value, ${uid} FROM json_each(${jsonText(questionIds)}) AS j
    WHERE true
    ON CONFLICT (question_id) DO NOTHING`;
}

// O(1), six statements in one transaction
// INV: SQLite serializes writers, so the mastery read and the following writes cannot interleave
export async function recordAttempt(a: AttemptIn, now: Date): Promise<Date | null> {
  const at = epochOf(now);
  return sql.begin(async (tx) => {
    const topics: { mastery: number }[] = await tx`SELECT mastery FROM topics WHERE id = ${a.topicId} AND user_id = ${a.uid} LIMIT 1`;
    const topic = topics[0];
    if (!topic) throw new Error("topic missing for owned question");
    const cards: CardRow[] = await tx`SELECT ef, interval_d, reps, lapses, due_at FROM cards WHERE question_id = ${a.questionId} AND user_id = ${a.uid} LIMIT 1`;
    const prev = cards[0];
    const isReview = prev !== undefined && prev.reps > 0;
    const correct = a.score >= CORRECT_AT;
    const confErr = Math.abs(a.confidence / 100 - a.score);
    // INV: a question outside any lesson can only be met in Practice, so its first attempt spends a new card even if no queue served it; a lesson check spends one only when Practice served it
    if (a.lessonId === null) await tx`
      INSERT INTO new_card_intros (question_id, user_id, day)
      SELECT ${a.questionId}, ${a.uid}, ${localDayOf(at)}
      WHERE NOT EXISTS (SELECT 1 FROM attempts WHERE user_id = ${a.uid} AND question_id = ${a.questionId})
      ON CONFLICT (question_id) DO NOTHING`;
    await tx`
      INSERT INTO attempts (user_id, question_id, topic_id, score, confidence, latency_ms, response, is_review, dont_know, created_at)
      VALUES (${a.uid}, ${a.questionId}, ${a.topicId}, ${a.score}, ${a.confidence}, ${a.latencyMs}, ${a.response}, ${bitOf(isReview)}, ${bitOf(a.dontKnow)}, ${at})`;
    let dueAt: Date | null = prev ? dateFromMs(prev.due_at) : null;
    if (a.srs.enabled) {
      const base: Card = prev ? { ef: prev.ef, intervalD: prev.interval_d, reps: prev.reps, lapses: prev.lapses, dueAt: dateFromMs(prev.due_at) } : { ef: 2.5, intervalD: 0, reps: 0, lapses: 0, dueAt: now };
      const next = scheduleSm2(base, qualityOf(a.score, a.confidence), now);
      dueAt = isRetired(next.reps, a.srs.repetitions) ? null : next.dueAt;
      await tx`
        INSERT INTO cards (question_id, user_id, ef, interval_d, reps, lapses, due_at)
        VALUES (${a.questionId}, ${a.uid}, ${next.ef}, ${next.intervalD}, ${next.reps}, ${next.lapses}, ${epochOf(next.dueAt)})
        ON CONFLICT (question_id) DO UPDATE SET ef = excluded.ef, interval_d = excluded.interval_d, reps = excluded.reps, lapses = excluded.lapses, due_at = excluded.due_at`;
    }
    await tx`
      UPDATE topics SET attempts = attempts + 1, correct = correct + ${correct ? 1 : 0}, conf_err_sum = conf_err_sum + ${confErr}, mastery = ${nextMastery(topic.mastery, a.score)}, last_seen_at = ${at}
      WHERE id = ${a.topicId} AND user_id = ${a.uid}`;
    await tx`
      INSERT INTO daily_activity (user_id, day, attempts, correct, reviews, review_correct, conf_err_sum)
      VALUES (${a.uid}, ${utcDayOf(at)}, 1, ${correct ? 1 : 0}, ${isReview ? 1 : 0}, ${isReview && correct ? 1 : 0}, ${confErr})
      ON CONFLICT (user_id, day) DO UPDATE SET attempts = daily_activity.attempts + 1, correct = daily_activity.correct + excluded.correct, reviews = daily_activity.reviews + excluded.reviews,
        review_correct = daily_activity.review_correct + excluded.review_correct, conf_err_sum = daily_activity.conf_err_sum + excluded.conf_err_sum`;
    return dueAt;
  });
}

// O(k) for k question ids, one statement
// INV: the newest scored attempt per question, by created_at then id; at most 64 ids
export async function listLatestAttempts(uid: string, questionIds: string[]): Promise<LatestAttempt[]> {
  if (questionIds.length === 0) return [];
  const rows: { question_id: string; score: number; confidence: number | null; dont_know: number; response: string | null }[] = await sql`
    SELECT a.question_id, a.score, a.confidence, a.dont_know, a.response FROM attempts a
    WHERE a.user_id = ${uid} AND a.question_id IN ${sql(questionIds)} AND a.score IS NOT NULL
      AND a.id = (SELECT a2.id FROM attempts a2 WHERE a2.user_id = ${uid} AND a2.question_id = a.question_id AND a2.score IS NOT NULL ORDER BY a2.created_at DESC, a2.id DESC LIMIT 1)
    LIMIT 64`;
  return rows.map((row) => ({ questionId: row.question_id, score: Number(row.score), confidence: row.confidence === null ? null : Number(row.confidence), dontKnow: Number(row.dont_know) === 1, response: row.response }));
}

// O(1)
export async function findUserSettings(uid: string): Promise<Record<string, unknown>> {
  const rows = await sql`SELECT settings FROM users WHERE id = ${uid} LIMIT 1` as { settings: unknown }[];
  const raw = jsonValue(rows[0]?.settings);
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  return Object.fromEntries(Object.entries(raw));
}

// O(1)
// INV: settings are stored as JSON text in v0.1.1's shape; stored is the row these settings were loaded from
export async function updateSettings(uid: string, s: Settings, stored: Record<string, unknown> = {}): Promise<void> {
  await sql`UPDATE users SET settings = ${jsonText(settingsToStored(s, stored))} WHERE id = ${uid}`;
}
