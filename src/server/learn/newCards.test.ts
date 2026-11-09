import { afterAll, beforeAll, beforeEach, expect, mock, setSystemTime, test } from "bun:test";
import { localDayOf, utcDayOf } from "../sqlmap.ts";
import { bootTestServer, callRoute, type Handler, type TestServer } from "../testkit.ts";

const UID = "00000000-0000-4000-8000-000000000001";
const CHECK = { kind: "mcq", stem: "Which word names the idea?", choices: ["alpha", "beta", "gamma", "delta"], answerIndex: 0, rubric: null, modelAnswer: null, explanation: "Because." };
const PLAN = { title: "T", topic: { name: "X", domain: "math" }, related: [], steps: [{ title: "One", summary: "s" }, { title: "Two", summary: "s" }] };
const originalTz = process.env.TZ;

let t: TestServer;
let queueRoute: Handler;
let attemptRoute: Handler;
let chatRoute: Handler;
let reply = "";
let topicId = "";

const NY_DAY_1 = "2026-03-10T12:00:00-04:00";

beforeAll(async () => {
  process.env.TZ = "America/New_York";
  t = await bootTestServer();
  mock.module("../llm/gateway.ts", () => ({
    chatJson: async () => ({ data: CHECK, costMicros: 0n }),
    chatStream: async (o: { onDone: (text: string, announce: () => void) => Promise<unknown> }) => {
      await o.onDone(reply, () => {});
      return new ReadableStream({ start(controller) { controller.close(); } });
    },
    assertQuotaHeadroom: async () => {},
  }));
  const { learnRoutes } = await import("./routes.ts");
  const { teachRoutes } = await import("../teach/routes.ts");
  queueRoute = learnRoutes["/api/practice/queue"].GET;
  attemptRoute = learnRoutes["/api/practice/attempt"].POST;
  chatRoute = teachRoutes["/api/lessons/:id/chat"].POST;
});

afterAll(() => {
  setSystemTime();
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
});

beforeEach(async () => {
  setSystemTime(new Date(NY_DAY_1));
  await t.reset();
  const [topic] = await t.sql`INSERT INTO topics (user_id, slug, name, domain) VALUES (${UID}, ${`t-${crypto.randomUUID()}`}, 'T', 'math') RETURNING id` as { id: string }[];
  topicId = topic?.id ?? "";
});

// O(1)
async function setCap(newPerDay: number, extra: Record<string, number> = {}): Promise<void> {
  await t.sql`UPDATE users SET settings = ${JSON.stringify({ srs: { newPerDay, ...extra } })} WHERE id = ${UID}`;
}

// O(1)
async function addCard(createdAt: number, opts: { lessonId?: string | null } = {}): Promise<string> {
  const [q] = await t.sql`
    INSERT INTO questions (user_id, topic_id, lesson_id, kind, stem, choices, answer, explanation, created_at)
    VALUES (${UID}, ${topicId}, ${opts.lessonId ?? null}, 'mcq', 's', ${JSON.stringify(["a", "b", "c", "d"])}, ${JSON.stringify({ index: 1 })}, 'because', ${createdAt}) RETURNING id` as { id: string }[];
  if (!q) throw new Error("question missing");
  await t.sql`INSERT INTO cards (question_id, user_id, due_at) VALUES (${q.id}, ${UID}, ${createdAt})`;
  return q.id;
}

// O(n)
// INV: ids come back oldest first
async function addNew(n: number, base = Date.parse("2026-01-01T00:00:00Z")): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < n; i += 1) ids.push(await addCard(base + i * 1000));
  return ids;
}

// O(1)
// INV: an already attempted question that is due again
async function addReview(reps: number, dueAt = Date.parse("2026-02-01T00:00:00Z")): Promise<string> {
  const id = await addCard(dueAt);
  await t.sql`UPDATE cards SET reps = ${reps} WHERE question_id = ${id}`;
  await t.sql`INSERT INTO attempts (user_id, question_id, topic_id, score, confidence, latency_ms, is_review) VALUES (${UID}, ${id}, ${topicId}, 1, 60, 5, 0)`;
  return id;
}

// O(queue)
async function queue(limit = 20): Promise<string[]> {
  const res = await callRoute(queueRoute, "GET", `/api/practice/queue?limit=${limit}`);
  expect(res.status).toBe(200);
  return (await res.json() as { id: string }[]).map((q) => q.id);
}

// O(1)
async function answer(questionId: string): Promise<void> {
  const res = await callRoute(attemptRoute, "POST", "/api/practice/attempt", { body: { questionId, choice: 1, confidence: 70, latencyMs: 10 } });
  expect(res.status).toBe(200);
}

test("practice serves at most the day's cap, oldest first, and reloading spends nothing", async () => {
  const ids = await addNew(5);
  await setCap(3);
  expect(await queue()).toEqual(ids.slice(0, 3));
  expect(await queue()).toEqual(ids.slice(0, 3));
  await answer(ids[0] ?? "");
  expect(await queue()).toEqual(ids.slice(1, 3));
  await answer(ids[1] ?? "");
  await answer(ids[2] ?? "");
  expect(await queue()).toEqual([]);
});

test("a set generated in the same instant keeps its insertion order", async () => {
  const same = Date.parse("2026-01-02T00:00:00Z");
  const ids = [await addCard(same), await addCard(same), await addCard(same)];
  await setCap(2);
  expect(await queue()).toEqual(ids.slice(0, 2));
});

test("the allowance resets at local midnight, not UTC midnight", async () => {
  const ids = await addNew(3);
  await setCap(1);
  setSystemTime(new Date("2026-03-10T19:30:00-04:00"));
  expect(utcDayOf(Date.now())).toBe("2026-03-10");
  expect(await queue()).toEqual([ids[0] ?? ""]);
  await answer(ids[0] ?? "");
  setSystemTime(new Date("2026-03-10T20:30:00-04:00"));
  expect(utcDayOf(Date.now())).toBe("2026-03-11");
  expect(localDayOf(Date.now())).toBe("2026-03-10");
  expect(await queue()).toEqual([]);
  setSystemTime(new Date("2026-03-10T23:59:00-04:00"));
  expect(await queue()).toEqual([]);
  setSystemTime(new Date("2026-03-11T00:01:00-04:00"));
  expect(localDayOf(Date.now())).toBe("2026-03-11");
  expect(await queue()).toEqual([ids[1] ?? ""]);
});

test("0 pauses new material and nothing is lost when it is raised", async () => {
  const ids = await addNew(3);
  await setCap(0);
  expect(await queue()).toEqual([]);
  setSystemTime(new Date("2026-03-12T12:00:00-04:00"));
  expect(await queue()).toEqual([]);
  await setCap(2);
  expect(await queue()).toEqual(ids.slice(0, 2));
});

test("questions over the cap carry over to later days, oldest first", async () => {
  const ids = await addNew(5);
  await setCap(2);
  expect(await queue()).toEqual(ids.slice(0, 2));
  await answer(ids[0] ?? "");
  setSystemTime(new Date("2026-03-11T12:00:00-04:00"));
  expect(await queue()).toEqual(ids.slice(0, 3));
  await answer(ids[1] ?? "");
  await answer(ids[2] ?? "");
  expect(await queue()).toEqual([ids[0] ?? ""]);
  setSystemTime(new Date("2026-03-12T12:00:00-04:00"));
  const day3 = await queue();
  expect(day3.slice(3)).toEqual(ids.slice(3, 5));
  expect(day3.slice(0, 3).toSorted()).toEqual(ids.slice(0, 3).toSorted());
});

test("reviews are never held back by the cap and come before new cards", async () => {
  const fresh = await addNew(2);
  const review = await addReview(1);
  const lapsed = await addReview(0, Date.parse("2026-02-02T00:00:00Z"));
  await setCap(0);
  expect(await queue()).toEqual([review, lapsed]);
  await setCap(1);
  expect(await queue()).toEqual([review, lapsed, fresh[0] ?? ""]);
  expect(await queue(1)).toEqual([review]);
});

test("answering new cards up to the cap leaves reviews available the same day", async () => {
  const ids = await addNew(2);
  const review = await addReview(2);
  await setCap(2);
  expect(await queue()).toEqual([review, ...ids]);
  await answer(ids[0] ?? "");
  await answer(ids[1] ?? "");
  expect(await queue()).toEqual([review]);
});

test("maxReviewsPerDay still stops the queue once the day's reviews are used", async () => {
  await addNew(2);
  await addReview(1);
  await setCap(5, { maxReviewsPerDay: 30 });
  await t.sql`INSERT INTO daily_activity (user_id, day, attempts, correct, reviews, review_correct, conf_err_sum) VALUES (${UID}, ${utcDayOf(Date.now())}, 30, 30, 30, 30, 0)`;
  expect(await queue()).toEqual([]);
  await t.sql`UPDATE daily_activity SET reviews = 29 WHERE user_id = ${UID}`;
  expect(await queue()).toHaveLength(1);
});

test("a saved cap above the range is clamped when loaded", async () => {
  const ids = await addNew(25);
  await setCap(99);
  expect(await queue(50)).toEqual(ids.slice(0, 20));
});

test("a first attempt on a practice question counts even when no queue served it", async () => {
  const ids = await addNew(3);
  await setCap(1);
  await answer(ids[2] ?? "");
  expect(await queue()).toEqual([]);
});

test("a tutor's check always appears, and answering it in the lesson spends no new card", async () => {
  const [lesson] = await t.sql`INSERT INTO lessons (user_id, topic_id, title, plan, model) VALUES (${UID}, ${topicId}, 'T', ${JSON.stringify(PLAN)}, 'm') RETURNING id` as { id: string }[];
  const lessonId = lesson?.id ?? "";
  await setCap(0);
  reply = "See what you make of this one.\n[[lesson topic=1 action=check]]";
  const res = await callRoute((req) => chatRoute(Object.assign(req, { params: { id: lessonId } })), "POST", "/x", { body: { message: "ready" } });
  expect(res.status).toBe(200);
  const [check] = await t.sql`SELECT q.id FROM questions q WHERE q.lesson_id = ${lessonId}` as { id: string }[];
  const checkId = check?.id ?? "";
  expect(checkId).not.toBe("");
  const [turn] = await t.sql`SELECT check_id FROM lesson_turns WHERE check_id = ${checkId}` as { check_id: string }[];
  expect(turn?.check_id).toBe(checkId);
  expect(await queue()).toEqual([]);

  const ids = await addNew(1);
  await setCap(1);
  await answer(checkId);
  expect(await queue()).toEqual([ids[0] ?? ""]);

  await t.sql`UPDATE cards SET due_at = ${Date.parse("2026-02-01T00:00:00Z")} WHERE question_id = ${checkId}`;
  await setCap(0);
  expect(await queue()).toEqual([checkId]);
});

test("an unanswered lesson check waits in Practice like any other new question", async () => {
  const [lesson] = await t.sql`INSERT INTO lessons (user_id, topic_id, title, plan, model) VALUES (${UID}, ${topicId}, 'T', ${JSON.stringify(PLAN)}, 'm') RETURNING id` as { id: string }[];
  const checkId = await addCard(Date.parse("2026-01-01T00:00:00Z"), { lessonId: lesson?.id ?? null });
  const later = await addCard(Date.parse("2026-01-02T00:00:00Z"));
  await setCap(1);
  expect(await queue()).toEqual([checkId]);
  await answer(checkId);
  expect(await queue()).toEqual([]);
  setSystemTime(new Date("2026-03-11T12:00:00-04:00"));
  expect(await queue()).toEqual([checkId, later]);
});
