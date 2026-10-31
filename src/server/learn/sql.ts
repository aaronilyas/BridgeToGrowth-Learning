import type { SQL } from "bun";
import type { Settings } from "../../shared/settings.ts";
import { sql } from "../db.ts";
import { CORRECT_AT, nextMastery, qualityOf, scheduleSm2, type Card, type QuestionRow } from "./core.ts";

export type AttemptIn = { uid: string; topicId: string; questionId: string; score: number; confidence: number; latencyMs: number; response: string | null; srsEnabled: boolean };
type CardRow = { ef: number; interval_d: number; reps: number; lapses: number; due_at: Date };

const QUESTION_COLS = sql`q.id, q.topic_id, q.lesson_id, q.kind, q.category, q.stem, q.choices, q.answer, q.explanation, q.citations`;

// O(log n)
export async function findQuestion(uid: string, id: string): Promise<QuestionRow | null> {
  const rows: QuestionRow[] = await sql`SELECT ${QUESTION_COLS} FROM questions q WHERE q.id = ${id} AND q.user_id = ${uid} LIMIT 1`;
  return rows[0] ?? null;
}

// O(log n)
export async function countReviewsToday(uid: string): Promise<number> {
  const rows: { reviews: number }[] = await sql`SELECT reviews FROM daily_activity WHERE user_id = ${uid} AND day = (now() AT TIME ZONE 'UTC')::date`;
  return rows[0]?.reviews ?? 0;
}

// O(log n + limit)
// INV: served by cards(user_id, due_at); due_at order
export async function listDueQuestions(uid: string, limit: number): Promise<QuestionRow[]> {
  return sql`
    SELECT ${QUESTION_COLS} FROM cards c JOIN questions q ON q.id = c.question_id
    WHERE c.user_id = ${uid} AND q.user_id = ${uid} AND c.due_at <= now()
    ORDER BY c.due_at LIMIT ${limit}`;
}

// O(k) in one statement
// INV: new cards are due immediately; idempotent per question
export async function insertCards(tx: SQL, uid: string, questionIds: string[]): Promise<void> {
  if (questionIds.length === 0) return;
  await tx`
    INSERT INTO cards (question_id, user_id)
    SELECT q.id, ${uid} FROM unnest(${questionIds}::uuid[]) AS q(id)
    ON CONFLICT (question_id) DO NOTHING`;
}

// O(1), six statements in one transaction
// INV: the topic row lock serializes concurrent attempts so the mastery EMA never loses an update; with srs disabled the card is untouched
export async function recordAttempt(a: AttemptIn, now: Date): Promise<Date | null> {
  return sql.begin(async (tx) => {
    const topics: { mastery: number }[] = await tx`SELECT mastery FROM topics WHERE id = ${a.topicId} AND user_id = ${a.uid} FOR UPDATE`;
    const topic = topics[0];
    if (!topic) throw new Error("topic missing for owned question");
    const cards: CardRow[] = await tx`SELECT ef, interval_d, reps, lapses, due_at FROM cards WHERE question_id = ${a.questionId} AND user_id = ${a.uid} FOR UPDATE`;
    const prev = cards[0];
    const isReview = prev !== undefined && prev.reps > 0;
    const correct = a.score >= CORRECT_AT;
    const confErr = Math.abs(a.confidence / 100 - a.score);
    await tx`
      INSERT INTO attempts (user_id, question_id, topic_id, score, confidence, latency_ms, response, is_review)
      VALUES (${a.uid}, ${a.questionId}, ${a.topicId}, ${a.score}, ${a.confidence}, ${a.latencyMs}, ${a.response}, ${isReview})`;
    let dueAt: Date | null = prev?.due_at ?? null;
    if (a.srsEnabled) {
      const base: Card = prev ? { ef: prev.ef, intervalD: prev.interval_d, reps: prev.reps, lapses: prev.lapses, dueAt: prev.due_at } : { ef: 2.5, intervalD: 0, reps: 0, lapses: 0, dueAt: now };
      const next = scheduleSm2(base, qualityOf(a.score, a.confidence), now);
      dueAt = next.dueAt;
      await tx`
        INSERT INTO cards (question_id, user_id, ef, interval_d, reps, lapses, due_at)
        VALUES (${a.questionId}, ${a.uid}, ${next.ef}, ${next.intervalD}, ${next.reps}, ${next.lapses}, ${next.dueAt})
        ON CONFLICT (question_id) DO UPDATE SET ef = EXCLUDED.ef, interval_d = EXCLUDED.interval_d, reps = EXCLUDED.reps, lapses = EXCLUDED.lapses, due_at = EXCLUDED.due_at`;
    }
    await tx`
      UPDATE topics SET attempts = attempts + 1, correct = correct + ${correct ? 1 : 0}, conf_err_sum = conf_err_sum + ${confErr}, mastery = ${nextMastery(topic.mastery, a.score)}, last_seen_at = ${now}
      WHERE id = ${a.topicId} AND user_id = ${a.uid}`;
    await tx`
      INSERT INTO daily_activity (user_id, day, attempts, correct, reviews, review_correct, conf_err_sum)
      VALUES (${a.uid}, (${now} AT TIME ZONE 'UTC')::date, 1, ${correct ? 1 : 0}, ${isReview ? 1 : 0}, ${isReview && correct ? 1 : 0}, ${confErr})
      ON CONFLICT (user_id, day) DO UPDATE SET attempts = daily_activity.attempts + 1, correct = daily_activity.correct + EXCLUDED.correct, reviews = daily_activity.reviews + EXCLUDED.reviews,
        review_correct = daily_activity.review_correct + EXCLUDED.review_correct, conf_err_sum = daily_activity.conf_err_sum + EXCLUDED.conf_err_sum`;
    return dueAt;
  });
}

// O(1)
// INV: Bun.sql double-encodes a string cast straight to jsonb; always write JSON via ${JSON.stringify(x)}::text::jsonb
export async function updateSettings(uid: string, s: Settings): Promise<void> {
  await sql`UPDATE users SET settings = ${JSON.stringify(s)}::text::jsonb WHERE id = ${uid}`;
}
