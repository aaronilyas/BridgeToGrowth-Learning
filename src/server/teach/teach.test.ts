import { beforeAll, expect, mock, test } from "bun:test";
import { bootTestServer, callRoute, createTestUser, type Handler, type TestServer } from "../testkit.ts";

let t: TestServer;
let h: { get: Handler; step: Handler; chat: Handler; del: Handler; create: Handler };
let upsertTopics: typeof import("../topics/sql.ts")["upsertTopics"];
let topicsReleasedByLesson: typeof import("../topics/core.ts")["topicsReleasedByLesson"];
const fetchUrlSource = mock(async (_url: string) => ({ kind: "text" as const, url: "https://example.com", title: "t", text: "body" }));

beforeAll(async () => {
  t = await bootTestServer();
  const { findUsage } = await import("../llm/sql.ts");
  const { periodOf } = await import("../llm/core.ts");
  const { HttpError } = await import("../http.ts");
  const assertQuotaHeadroom = async (who: { uid: string; capMicros: bigint }): Promise<void> => {
    const u = await findUsage(who.uid, periodOf(new Date()));
    if (u.usedMicros + u.reservedMicros >= who.capMicros) throw new HttpError(429, "quota_exceeded");
  };
  const never = async (): Promise<never> => {
    throw new Error("llm must not be reached");
  };
  mock.module("../sources/web.ts", () => ({ fetchUrlSource }));
  mock.module("../llm/gateway.ts", () => ({ chatJson: never, chatStream: never, startPricingRefresh: () => {}, assertQuotaHeadroom }));
  upsertTopics = (await import("../topics/sql.ts")).upsertTopics;
  topicsReleasedByLesson = (await import("../topics/core.ts")).topicsReleasedByLesson;
  const { teachRoutes } = await import("./routes.ts");
  const withParams = (fn: Handler, params: Record<string, string>): Handler => (req) => fn(Object.assign(req, { params }));
  const a = teachRoutes;
  h = {
    get: (req) => withParams(a["/api/lessons/:id"].GET, { id: new URL(req.url).searchParams.get("id") ?? "" })(req),
    step: (req) => withParams(a["/api/lessons/:id/steps/:idx"].POST, { id: new URL(req.url).searchParams.get("id") ?? "", idx: "0" })(req),
    chat: (req) => withParams(a["/api/lessons/:id/chat"].POST, { id: new URL(req.url).searchParams.get("id") ?? "" })(req),
    del: (req) => withParams(a["/api/lessons/:id"].DELETE, { id: new URL(req.url).searchParams.get("id") ?? "" })(req),
    create: a["/api/lessons"].POST,
  };
});

test("another user's lesson is 404 for the session user", async () => {
  await t.reset();
  const local = await createTestUser();
  const other = await createTestUser();
  const plan = { title: "T", topic: { name: "X", domain: "math" }, related: [], steps: [{ title: "s", summary: "s" }] };
  const [foreignTopic] = await t.sql`INSERT INTO topics (user_id, slug, name, domain) VALUES (${other.id}, 'x', 'X', 'math') RETURNING id`;
  const [foreign] = await t.sql`INSERT INTO lessons (user_id, topic_id, title, plan, model) VALUES (${other.id}, ${foreignTopic.id}, 'T', ${JSON.stringify(plan)}::text::jsonb, 'm') RETURNING id`;
  const hidden = `?id=${foreign.id}`;
  const cookie = local.cookie;
  expect((await callRoute(h.get, "GET", `/x${hidden}`, { cookie })).status).toBe(404);
  expect((await callRoute(h.step, "POST", `/x${hidden}`, { cookie, body: {} })).status).toBe(404);
  expect((await callRoute(h.chat, "POST", `/x${hidden}`, { cookie, body: { message: "hi" } })).status).toBe(404);
  const [ownTopic] = await t.sql`INSERT INTO topics (user_id, slug, name, domain) VALUES (${local.id}, 'y', 'Y', 'math') RETURNING id`;
  const [own] = await t.sql`INSERT INTO lessons (user_id, topic_id, title, plan, model) VALUES (${local.id}, ${ownTopic.id}, 'T', ${JSON.stringify(plan)}::text::jsonb, 'm') RETURNING id`;
  expect((await callRoute(h.get, "GET", `/x?id=${own.id}`, { cookie })).status).toBe(200);
  expect((await callRoute(h.get, "GET", `/x?id=${own.id}`)).status).toBe(401);
});

test("upsertTopics is idempotent and dedupes by slug", async () => {
  await t.reset();
  const u = await createTestUser();
  const names = ["Newton's  Laws", "newtons laws", "Inertia"].map((name) => ({ name, domain: "physics" as const }));
  const edges = [{ src: 0, dst: 2, kind: "prereq" as const }];
  const first = await upsertTopics(t.sql, u.id, names, edges);
  const second = await upsertTopics(t.sql, u.id, names, edges);
  expect(second).toEqual(first);
  expect(first[0]).toBe(first[1]);
  expect(first[0]).not.toBe(first[2]);
  const [{ n }] = await t.sql`SELECT count(*)::int AS n FROM topic_edges WHERE user_id = ${u.id}`;
  expect(n).toBe(1);
});

const plan = { title: "T", topic: { name: "X", domain: "math" }, related: [], steps: [{ title: "s", summary: "s" }] };

async function addTopic(uid: string, slug: string): Promise<string> {
  const [row] = await t.sql`INSERT INTO topics (user_id, slug, name, domain, mastery, attempts, correct, conf_err_sum) VALUES (${uid}, ${slug}, ${slug}, 'math', 0.9, 9, 9, 4) RETURNING id`;
  if (!row) throw new Error("topic missing");
  return row.id;
}

async function addLesson(uid: string, topicId: string): Promise<string> {
  const [row] = await t.sql`INSERT INTO lessons (user_id, topic_id, title, plan, model) VALUES (${uid}, ${topicId}, 'T', ${JSON.stringify(plan)}::text::jsonb, 'm') RETURNING id`;
  if (!row) throw new Error("lesson missing");
  return row.id;
}

async function addQuestion(uid: string, topicId: string, lessonId: string | null): Promise<string> {
  const [row] = await t.sql`
    INSERT INTO questions (user_id, topic_id, lesson_id, kind, stem, choices, answer, explanation)
    VALUES (${uid}, ${topicId}, ${lessonId}, 'mcq', 's', ${JSON.stringify(["a", "b", "c", "d"])}::text::jsonb, ${JSON.stringify({ index: 1 })}::text::jsonb, 'because') RETURNING id`;
  if (!row) throw new Error("question missing");
  await t.sql`INSERT INTO cards (question_id, user_id) VALUES (${row.id}, ${uid})`;
  return row.id;
}

async function addAttempt(uid: string, topicId: string, questionId: string, score: number, confidence: number, review: boolean): Promise<void> {
  await t.sql`INSERT INTO attempts (user_id, question_id, topic_id, score, confidence, latency_ms, is_review) VALUES (${uid}, ${questionId}, ${topicId}, ${score}, ${confidence}, 10, ${review})`;
}

test("topicsReleasedByLesson keeps a topic another lesson still uses", () => {
  const use = (lessons: number, questions = 0): { lessons: number; questions: number; attempts: number } => ({ lessons, questions, attempts: 0 });
  expect(topicsReleasedByLesson("L", ["N"], new Map([["L", use(0)], ["N", use(0)], ["K", use(1)]]), [{ src: "L", dst: "N" }, { src: "K", dst: "N" }])).toEqual(["L"]);
  expect(topicsReleasedByLesson("L", ["N"], new Map([["L", use(0)], ["N", use(0)]]), [{ src: "L", dst: "N" }]).sort()).toEqual(["L", "N"]);
  expect(topicsReleasedByLesson("L", ["N"], new Map([["L", use(1)], ["N", use(0)]]), [{ src: "L", dst: "N" }])).toEqual([]);
  expect(topicsReleasedByLesson("L", [], new Map([["L", use(0, 1)]]), [])).toEqual([]);
});

test("deleting a lesson removes its chat, checks, and topics nothing else uses", async () => {
  await t.reset();
  const u = await createTestUser();
  const other = await createTestUser();
  const topicId = await addTopic(u.id, "photo");
  const relatedId = await addTopic(u.id, "chloro");
  const keptId = await addTopic(u.id, "algebra");
  await t.sql`INSERT INTO topic_edges (user_id, src, dst, kind) VALUES (${u.id}, ${topicId}, ${relatedId}, 'related')`;
  const lessonId = await addLesson(u.id, topicId);
  const qid = await addQuestion(u.id, topicId, lessonId);
  await addAttempt(u.id, topicId, qid, 1, 80, true);
  const keptQ = await addQuestion(u.id, keptId, null);
  await addAttempt(u.id, keptId, keptQ, 1, 50, false);
  const [conv] = await t.sql`INSERT INTO conversations (user_id, lesson_id) VALUES (${u.id}, ${lessonId}) RETURNING id`;
  if (!conv) throw new Error("conversation missing");
  await t.sql`INSERT INTO messages (conv_id, role, content) VALUES (${conv.id}, 'user', 'hi')`;
  await t.sql`INSERT INTO lesson_steps (lesson_id, idx, content) VALUES (${lessonId}, 0, ${JSON.stringify({ questionId: qid })}::text::jsonb)`;
  await t.sql`INSERT INTO daily_activity (user_id, day, attempts, correct, reviews, review_correct, conf_err_sum) VALUES (${u.id}, (now() AT TIME ZONE 'UTC')::date, 9, 9, 9, 9, 9)`;
  await t.sql`INSERT INTO insights (user_id, day, body) VALUES (${u.id}, (now() AT TIME ZONE 'UTC')::date, ${JSON.stringify({ trends: [] })}::text::jsonb)`;
  await t.sql`INSERT INTO insights (user_id, day, body) VALUES (${u.id}, ((now() AT TIME ZONE 'UTC')::date - 1), ${JSON.stringify({ trends: [] })}::text::jsonb)`;
  const foreignLesson = await addLesson(other.id, await addTopic(other.id, "foreign"));
  const cookie = u.cookie;
  expect((await callRoute(h.del, "DELETE", `/x?id=${lessonId}`, { cookie })).status).toBe(204);
  expect((await callRoute(h.del, "DELETE", `/x?id=${lessonId}`, { cookie })).status).toBe(404);
  expect((await callRoute(h.del, "DELETE", `/x?id=${foreignLesson}`, { cookie })).status).toBe(404);
  expect((await callRoute(h.del, "DELETE", "/x?id=not-a-uuid", { cookie })).status).toBe(404);
  const [left] = await t.sql`
    SELECT
      (SELECT count(*)::int FROM lessons WHERE id = ${lessonId}) AS lessons,
      (SELECT count(*)::int FROM lessons WHERE id = ${foreignLesson}) AS foreign_lessons,
      (SELECT count(*)::int FROM questions WHERE id = ${qid}) AS questions,
      (SELECT count(*)::int FROM questions WHERE id = ${keptQ}) AS kept_questions,
      (SELECT count(*)::int FROM cards WHERE question_id = ${qid}) AS cards,
      (SELECT count(*)::int FROM cards WHERE question_id = ${keptQ}) AS kept_cards,
      (SELECT count(*)::int FROM attempts WHERE question_id = ${qid}) AS attempts,
      (SELECT count(*)::int FROM attempts WHERE question_id = ${keptQ}) AS kept_attempts,
      (SELECT count(*)::int FROM topics WHERE id = ${topicId}) AS topics,
      (SELECT count(*)::int FROM topics WHERE id = ${relatedId}) AS related,
      (SELECT count(*)::int FROM topics WHERE id = ${keptId}) AS kept_topics,
      (SELECT count(*)::int FROM topic_edges WHERE user_id = ${u.id}) AS edges,
      (SELECT count(*)::int FROM messages m JOIN conversations c ON c.id = m.conv_id WHERE c.user_id = ${u.id}) AS messages,
      (SELECT count(*)::int FROM lesson_steps WHERE lesson_id = ${lessonId}) AS steps,
      (SELECT count(*)::int FROM conversations WHERE user_id = ${u.id}) AS convos,
      (SELECT count(*)::int FROM insights WHERE user_id = ${u.id} AND day = (now() AT TIME ZONE 'UTC')::date) AS today_insights,
      (SELECT count(*)::int FROM insights WHERE user_id = ${u.id} AND day = ((now() AT TIME ZONE 'UTC')::date - 1)) AS old_insights`;
  expect(left).toEqual({
    lessons: 0, foreign_lessons: 1, questions: 0, kept_questions: 1, cards: 0, kept_cards: 1, attempts: 0, kept_attempts: 1,
    topics: 0, related: 0, kept_topics: 1, edges: 0, messages: 0, steps: 0, convos: 0, today_insights: 0, old_insights: 1,
  });
  const [day] = await t.sql`SELECT attempts, correct, reviews, review_correct, conf_err_sum FROM daily_activity WHERE user_id = ${u.id}`;
  expect([day.attempts, day.correct, day.reviews, day.review_correct]).toEqual([1, 1, 0, 0]);
  expect(Math.abs(day.conf_err_sum - 0.5)).toBeLessThan(1e-5);
  const [keptTopic] = await t.sql`SELECT attempts, mastery FROM topics WHERE id = ${keptId}`;
  expect(keptTopic.attempts).toBe(9);
  expect(Math.abs(keptTopic.mastery - 0.9)).toBeLessThan(1e-6);
});

test("deleting a lesson replays mastery from the attempts that remain", async () => {
  await t.reset();
  const u = await createTestUser();
  const topicId = await addTopic(u.id, "shared");
  const relatedId = await addTopic(u.id, "stub");
  await t.sql`INSERT INTO topic_edges (user_id, src, dst, kind) VALUES (${u.id}, ${topicId}, ${relatedId}, 'prereq')`;
  const dropLesson = await addLesson(u.id, topicId);
  const keepLesson = await addLesson(u.id, topicId);
  const dropQ = await addQuestion(u.id, topicId, dropLesson);
  const keepQ = await addQuestion(u.id, topicId, keepLesson);
  const practiceQ = await addQuestion(u.id, topicId, null);
  await addAttempt(u.id, topicId, dropQ, 1, 0, false);
  await addAttempt(u.id, topicId, keepQ, 0, 100, false);
  await t.sql`UPDATE topics SET mastery = 0.21, attempts = 2, correct = 1, conf_err_sum = 2 WHERE id = ${topicId} AND user_id = ${u.id}`;
  expect((await callRoute(h.del, "DELETE", `/x?id=${dropLesson}`, { cookie: u.cookie })).status).toBe(204);
  const [topic] = await t.sql`SELECT attempts, correct, mastery, conf_err_sum FROM topics WHERE id = ${topicId}`;
  expect(topic.attempts).toBe(1);
  expect(topic.correct).toBe(0);
  expect(Math.abs(topic.mastery)).toBeLessThan(1e-6);
  expect(Math.abs(topic.conf_err_sum - 1)).toBeLessThan(1e-5);
  const [counts] = await t.sql`
    SELECT
      (SELECT count(*)::int FROM lessons WHERE id = ${keepLesson}) AS lessons,
      (SELECT count(*)::int FROM questions WHERE id = ${dropQ}) AS dropped,
      (SELECT count(*)::int FROM questions WHERE id = ${keepQ}) AS kept,
      (SELECT count(*)::int FROM questions WHERE id = ${practiceQ}) AS practice,
      (SELECT count(*)::int FROM topics WHERE id = ${relatedId}) AS related,
      (SELECT count(*)::int FROM cards WHERE question_id = ${keepQ} OR question_id = ${practiceQ}) AS cards`;
  expect(counts).toEqual({ lessons: 1, dropped: 0, kept: 1, practice: 1, related: 1, cards: 2 });
});

test("a generated quick check stores math inside dollar delimiters", async () => {
  const { normalizeStep, buildStepPrompt } = await import("./core.ts");
  const { Settings } = await import("../../shared/settings.ts");
  const { MATH_DELIM_RULE } = await import("../../shared/math.ts");
  expect(buildStepPrompt(Settings.parse({}), { title: "T", topic: { name: "X", domain: "math" }, related: [], steps: [{ title: "s", summary: "s" }] }, 0, [])).toContain(MATH_DELIM_RULE);
  const step = normalizeStep(
    {
      explanationMd: "An ODE has the form $dy/dx = f(x, y)$.",
      keyIdea: "Separate the variables.",
      example: "Solve $dy/dx = x y$.",
      check: {
        kind: "mcq",
        stem: "Which of the following first-order ODEs is separable?",
        choices: ["dy/dx = x + y", "dy/dx = x^2 y^3", "dy/dx = sin(x+y)", "dy/dx = e^{x} + e^{y}"],
        answerIndex: 1,
        rubric: null,
        modelAnswer: null,
        explanation: "Only option B factors as a product of a function of x (x^2) and a function of y (y^3), allowing separation into dy/y^3 = x^2 dx.",
      },
    },
    "Separable",
    180,
    [],
    "mcq",
  );
  expect(step.check.choices).toEqual(["$dy/dx = x + y$", "$dy/dx = x^2 y^3$", "$dy/dx = sin(x+y)$", "$dy/dx = e^{x} + e^{y}$"]);
  expect(step.check.stem).toBe("Which of the following first-order ODEs is separable?");
  expect(step.check.explanation).toBe("Only option B factors as a product of a function of $x (x^2)$ and a function of $y (y^3)$, allowing separation into $dy/y^3 = x^2 dx$.");
  expect(step.content.explanationMd).toBe("An ODE has the form $dy/dx = f(x, y)$.");
  expect(step.content.example).toBe("Solve $dy/dx = x y$.");
});

test("a free user whose usage_periods.used_micros equals the cap gets 429 from POST /api/lessons with a URL attached, and the mocked fetchUrlSource is never called", async () => {
  await t.reset();
  const u = await createTestUser({ plan: "free" });
  const { entitlementOf } = await import("../billing/core.ts");
  const { periodOf } = await import("../llm/core.ts");
  const { capMicros } = entitlementOf({ sub_status: "none" });
  const period = periodOf(new Date());
  await t.sql`INSERT INTO usage_periods (user_id, period, used_micros, reserved_micros) VALUES (${u.id}, ${period}::date, ${capMicros}, 0)`;
  fetchUrlSource.mockClear();
  const res = await callRoute(h.create, "POST", "/api/lessons", {
    cookie: u.cookie,
    body: { prompt: "Intro to Quantum Mechanics", urls: ["https://example.com/syllabus.html"] },
  });
  expect(res.status).toBe(429);
  expect(await res.json()).toEqual({ error: "quota_exceeded" });
  expect(fetchUrlSource).not.toHaveBeenCalled();
});
