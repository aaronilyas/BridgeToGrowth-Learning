import { beforeAll, expect, test } from "bun:test";
import { bootTestServer, createTestUser, insertFixtureUser, type TestServer } from "../testkit.ts";

let t: TestServer;
let deleteLessonData: typeof import("./sql.ts")["deleteLessonData"];

const plan = { title: "T", topic: { name: "X", domain: "math" }, related: [], outline: [{ title: "s", summary: "s" }] };

beforeAll(async () => {
  t = await bootTestServer();
  deleteLessonData = (await import("./sql.ts")).deleteLessonData;
});

async function addQuestion(uid: string, topicId: string, lessonId: string | null): Promise<string> {
  const [row] = await t.sql`
    INSERT INTO questions (user_id, topic_id, lesson_id, kind, stem, choices, answer, explanation)
    VALUES (${uid}, ${topicId}, ${lessonId}, 'mcq', 's', ${JSON.stringify(["a", "b", "c", "d"])}, ${JSON.stringify({ index: 1 })}, 'because') RETURNING id`;
  if (!row) throw new Error("question missing");
  return row.id;
}

async function addAttempt(uid: string, topicId: string, questionId: string, at: string, score: number, confidence: number, review: boolean): Promise<void> {
  await t.sql`
    INSERT INTO attempts (user_id, question_id, topic_id, score, confidence, latency_ms, is_review, created_at)
    VALUES (${uid}, ${questionId}, ${topicId}, ${score}, ${confidence}, 10, ${review ? 1 : 0}, ${Date.parse(at)})`;
}

test("deleting a lesson whose attempts span 2 UTC days rebuilds daily_activity for both days exactly as before", async () => {
  await t.reset();
  const u = await createTestUser();
  const otherId = await insertFixtureUser(t.sql);
  const [topic] = await t.sql`INSERT INTO topics (user_id, slug, name, domain) VALUES (${u.id}, 'span', 'Span', 'math') RETURNING id`;
  const [otherTopic] = await t.sql`INSERT INTO topics (user_id, slug, name, domain) VALUES (${otherId}, 'span', 'Span', 'math') RETURNING id`;
  const [lesson] = await t.sql`INSERT INTO lessons (user_id, topic_id, title, plan, model) VALUES (${u.id}, ${topic.id}, 'T', ${JSON.stringify(plan)}, 'm') RETURNING id`;
  const dropQ = await addQuestion(u.id, topic.id, lesson.id);
  const keepQ = await addQuestion(u.id, topic.id, null);
  const otherQ = await addQuestion(otherId, otherTopic.id, null);
  await addAttempt(u.id, topic.id, dropQ, "2026-03-01T23:59:59.999Z", 1, 90, false);
  await addAttempt(u.id, topic.id, dropQ, "2026-03-02T00:00:00.000Z", 0, 40, true);
  await addAttempt(u.id, topic.id, keepQ, "2026-03-01T00:00:00.000Z", 1, 70, true);
  await addAttempt(u.id, topic.id, keepQ, "2026-03-01T23:59:59.999Z", 0.5, 50, false);
  await addAttempt(u.id, topic.id, keepQ, "2026-03-02T23:59:59.999Z", 1, 100, true);
  await addAttempt(u.id, topic.id, keepQ, "2026-03-03T00:00:00.000Z", 1, 10, false);
  await addAttempt(u.id, topic.id, keepQ, "2026-02-28T23:59:59.999Z", 0, 0, false);
  await addAttempt(otherId, otherTopic.id, otherQ, "2026-03-01T12:00:00.000Z", 1, 100, true);
  await t.sql`
    INSERT INTO daily_activity (user_id, day, attempts, correct, reviews, review_correct, conf_err_sum) VALUES
    (${u.id}, '2026-03-01', 9, 9, 9, 9, 9), (${u.id}, '2026-03-02', 9, 9, 9, 9, 9), (${u.id}, '2026-03-03', 7, 7, 7, 7, 7),
    (${otherId}, '2026-03-01', 5, 5, 5, 5, 5)`;
  expect(await deleteLessonData(u.id, lesson.id)).toBe(true);
  const days = ["2026-03-01", "2026-03-02"];
  const rows = await t.sql`
    SELECT user_id, day, attempts, correct, reviews, review_correct, round(conf_err_sum, 4) AS conf
    FROM daily_activity WHERE user_id = ${u.id} OR user_id = ${otherId} ORDER BY user_id = ${otherId}, day LIMIT 10`;
  const legacy = await t.sql`
    SELECT ${u.id} AS user_id, strftime('%Y-%m-%d', a.created_at / 1000, 'unixepoch') AS day, count(*) AS attempts,
      count(*) FILTER (WHERE a.score >= 0.6) AS correct, count(*) FILTER (WHERE a.is_review = 1) AS reviews,
      count(*) FILTER (WHERE a.is_review = 1 AND a.score >= 0.6) AS review_correct, round(coalesce(sum(abs(a.confidence / 100.0 - a.score)), 0), 4) AS conf
    FROM attempts a WHERE a.user_id = ${u.id} AND strftime('%Y-%m-%d', a.created_at / 1000, 'unixepoch') IN ${t.sql(days)}
    GROUP BY strftime('%Y-%m-%d', a.created_at / 1000, 'unixepoch') ORDER BY day LIMIT 10`;
  expect(rows.slice(0, 2)).toEqual([...legacy]);
  expect([...rows]).toEqual([
    { user_id: u.id, day: "2026-03-01", attempts: 2, correct: 1, reviews: 1, review_correct: 1, conf: 0.3 },
    { user_id: u.id, day: "2026-03-02", attempts: 1, correct: 1, reviews: 1, review_correct: 1, conf: 0 },
    { user_id: u.id, day: "2026-03-03", attempts: 7, correct: 7, reviews: 7, review_correct: 7, conf: 7 },
    { user_id: otherId, day: "2026-03-01", attempts: 5, correct: 5, reviews: 5, review_correct: 5, conf: 5 },
  ]);
});
