import { beforeAll, expect, mock, test } from "bun:test";
import { bootTestServer, callRoute, createTestUser, insertFixtureUser, type Handler, type TestServer } from "../testkit.ts";

let t: TestServer;
let h: { generate: Handler; list: Handler; del: Handler; regen: Handler; queue: Handler };
let runSync: () => Promise<void>;
let topicName = "Hadamard product";
let genCalls = 0;
let failGen = false;

const mcq = (category: "terminology" | "conceptual" | "mcq", stem: string) => ({ category, kind: "mcq" as const, stem, choices: ["a", "b", "c", "d"], answerIndex: 0, rubric: null, modelAnswer: null, starterLines: null, solutionLines: null, libraries: null, tests: null, explanation: "Because." });

beforeAll(async () => {
  t = await bootTestServer();
  mock.module("../lit/openalex.ts", () => ({ retrievePapers: async () => [] }));
  mock.module("../llm/gateway.ts", () => ({
    chatJson: async () => {
      genCalls += 1;
      if (failGen) throw new Error("provider down");
      return {
        data: {
          topic: { name: topicName, domain: "math" },
          questions: [
            mcq("terminology", `Term ${genCalls}`),
            mcq("conceptual", `Concept ${genCalls}`),
            mcq("mcq", `Choice ${genCalls}`),
            { category: "free", kind: "free", stem: `Explain ${genCalls}`, choices: null, answerIndex: null, rubric: "r", modelAnswer: "m", starterLines: null, solutionLines: null, libraries: null, tests: null, explanation: "Because." },
          ],
        },
        costMicros: 0n,
      };
    },
  }));
  const { genRoutes } = await import("./routes.ts");
  const { learnRoutes } = await import("../learn/routes.ts");
  const withId = (fn: Handler): Handler => (req) => fn(Object.assign(req, { params: { id: new URL(req.url).searchParams.get("id") ?? "" } }));
  h = {
    generate: genRoutes["/api/questions/generate"].POST,
    list: genRoutes["/api/practice/sets"].GET,
    del: withId(genRoutes["/api/practice/sets/:id"].DELETE),
    regen: withId(genRoutes["/api/practice/sets/:id/regenerate"].POST),
    queue: learnRoutes["/api/practice/queue"].GET,
  };
  const { default: syncPracticeSets } = await import("../../../db/sync_practice_sets.sql", { with: { type: "text" } });
  runSync = async () => {
    await t.sql.begin(async (tx) => {
      await tx.unsafe(syncPracticeSets);
    });
  };
});

type SetJson = { id: string; topic: string; request: string; questions: number; answered: number };

async function generate(topic: string): Promise<{ setId: string; questions: { id: string }[] }> {
  const res = await callRoute(h.generate, "POST", "/api/questions/generate", { body: { topic } });
  expect(res.status).toBe(200);
  return await res.json() as { setId: string; questions: { id: string }[] };
}

async function sets(): Promise<SetJson[]> {
  return await (await callRoute(h.list, "GET", "/api/practice/sets")).json() as SetJson[];
}

async function answer(questionId: string, topicId: string, score: number): Promise<void> {
  const u = await createTestUser();
  await t.sql`INSERT INTO attempts (user_id, question_id, topic_id, score, confidence, is_review) VALUES (${u.id}, ${questionId}, ${topicId}, ${score}, 80, 0)`;
  await t.sql`UPDATE topics SET attempts = attempts + 1, mastery = 0.9 WHERE id = ${topicId}`;
}

test("a generated set is listed with the topic text it came from and its progress", async () => {
  await t.reset();
  topicName = "Hadamard product";
  const g = await generate("element-wise matrix product");
  expect(g.questions).toHaveLength(4);
  const [topic] = await t.sql`SELECT topic_id FROM questions WHERE id = ${g.questions[0]?.id}`;
  await answer(g.questions[0]?.id ?? "", topic.topic_id, 1);
  const listed = await sets();
  expect(listed).toHaveLength(1);
  expect(listed[0]).toMatchObject({ id: g.setId, topic: "Hadamard product", request: "element-wise matrix product", questions: 4, answered: 1 });
});

test("deleting a set removes its questions and the progress that came from them, and keeps other sets", async () => {
  await t.reset();
  topicName = "Hadamard product";
  const drop = await generate("hadamard");
  topicName = "Kronecker product";
  const keep = await generate("kronecker");
  const [dropTopic] = await t.sql`SELECT topic_id FROM questions WHERE id = ${drop.questions[0]?.id}`;
  await answer(drop.questions[0]?.id ?? "", dropTopic.topic_id, 1);
  expect((await callRoute(h.del, "DELETE", `/x?id=${drop.setId}`)).status).toBe(204);
  expect((await callRoute(h.del, "DELETE", `/x?id=${drop.setId}`)).status).toBe(404);
  expect((await callRoute(h.del, "DELETE", "/x?id=not-a-uuid")).status).toBe(404);
  expect((await sets()).map((s) => s.id)).toEqual([keep.setId]);
  expect(await t.sql`SELECT id FROM questions WHERE id IN ${t.sql(drop.questions.map((q) => q.id))}`).toHaveLength(0);
  expect(await t.sql`SELECT id FROM attempts`).toHaveLength(0);
  expect(await t.sql`SELECT id FROM topics WHERE id = ${dropTopic.topic_id}`).toHaveLength(0);
  expect(await t.sql`SELECT id FROM questions WHERE id IN ${t.sql(keep.questions.map((q) => q.id))}`).toHaveLength(4);
});

test("another user's set is 404 and left alone", async () => {
  await t.reset();
  const other = await insertFixtureUser(t.sql);
  const [topic] = await t.sql`INSERT INTO topics (user_id, slug, name, domain) VALUES (${other}, 'x', 'X', 'math') RETURNING id`;
  const [set] = await t.sql`INSERT INTO practice_sets (user_id, topic_id, request) VALUES (${other}, ${topic.id}, 'x') RETURNING id`;
  expect((await callRoute(h.del, "DELETE", `/x?id=${set.id}`)).status).toBe(404);
  const calls = genCalls;
  expect((await callRoute(h.regen, "POST", `/x?id=${set.id}`, { body: {} })).status).toBe(404);
  expect(genCalls).toBe(calls);
  expect(await sets()).toHaveLength(0);
  expect(await t.sql`SELECT id FROM practice_sets WHERE id = ${set.id}`).toHaveLength(1);
});

test("regenerating swaps in a new set for the same topic text and removes the old one", async () => {
  await t.reset();
  topicName = "Hadamard product";
  const old = await generate("hadamard");
  const res = await callRoute(h.regen, "POST", `/x?id=${old.setId}`, { body: {} });
  expect(res.status).toBe(200);
  const fresh = await res.json() as { setId: string; questions: { id: string }[] };
  expect(fresh.setId).not.toBe(old.setId);
  expect(fresh.questions).toHaveLength(4);
  const listed = await sets();
  expect(listed.map((s) => s.id)).toEqual([fresh.setId]);
  expect(listed[0]?.request).toBe("hadamard");
  expect(await t.sql`SELECT id FROM questions WHERE id IN ${t.sql(old.questions.map((q) => q.id))}`).toHaveLength(0);
  expect(await t.sql`SELECT question_id FROM cards`).toHaveLength(4);
});

test("a failed regeneration leaves the old set untouched", async () => {
  await t.reset();
  const old = await generate("hadamard");
  failGen = true;
  try {
    expect((await callRoute(h.regen, "POST", `/x?id=${old.setId}`, { body: {} })).status).toBeGreaterThanOrEqual(500);
  } finally {
    failGen = false;
  }
  expect((await sets()).map((s) => s.id)).toEqual([old.setId]);
  expect(await t.sql`SELECT id FROM questions`).toHaveLength(4);
});

test("practice questions written without a set (before 0009, or by an older build) are grouped into sets once", async () => {
  await t.reset();
  const u = await createTestUser();
  const [topic] = await t.sql`INSERT INTO topics (user_id, slug, name, domain) VALUES (${u.id}, 'h', 'Hadamard product', 'math') RETURNING id`;
  const [lessonTopic] = await t.sql`INSERT INTO topics (user_id, slug, name, domain) VALUES (${u.id}, 'l', 'Lesson topic', 'math') RETURNING id`;
  const [lesson] = await t.sql`INSERT INTO lessons (user_id, topic_id, title, plan, model) VALUES (${u.id}, ${lessonTopic.id}, 'L', '{}', 'm') RETURNING id`;
  const insert = (at: number, lessonId: string | null, topicId: string) => t.sql`
    INSERT INTO questions (user_id, topic_id, lesson_id, kind, category, stem, choices, answer, explanation, created_at)
    VALUES (${u.id}, ${topicId}, ${lessonId}, 'mcq', 'mcq', 's', '["a","b","c","d"]', '{"index":0}', 'e', ${at})`;
  for (let i = 0; i < 4; i++) await insert(1000, null, topic.id);
  for (let i = 0; i < 4; i++) await insert(2000, null, topic.id);
  await insert(3000, lesson.id, lessonTopic.id);
  await runSync();
  await runSync();
  const listed = await sets();
  expect(listed.map((s) => [s.topic, s.request, s.questions])).toEqual([["Hadamard product", "Hadamard product", 4], ["Hadamard product", "Hadamard product", 4]]);
  expect(await t.sql`SELECT question_id FROM practice_set_questions`).toHaveLength(8);
});

test("the practice queue names the set each question came from, and a deleted set leaves the queue", async () => {
  await t.reset();
  topicName = "Hadamard product";
  const drop = await generate("hadamard");
  topicName = "Kronecker product";
  const keep = await generate("kronecker");
  const queue = async (): Promise<{ id: string; setId: string | null }[]> => await (await callRoute(h.queue, "GET", "/api/practice/queue?limit=20")).json() as { id: string; setId: string | null }[];
  const before = await queue();
  expect(before).toHaveLength(8);
  const setOf = new Map([...drop.questions.map((q) => [q.id, drop.setId] as const), ...keep.questions.map((q) => [q.id, keep.setId] as const)]);
  for (const item of before) expect(item.setId).toBe(setOf.get(item.id) ?? "missing");
  expect((await callRoute(h.del, "DELETE", `/x?id=${drop.setId}`)).status).toBe(204);
  const after = await queue();
  expect(after.map((q) => q.setId)).toEqual(Array(4).fill(keep.setId));
});
