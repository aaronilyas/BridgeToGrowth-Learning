import { beforeAll, expect, mock, test } from "bun:test";
import { bootTestServer, callRoute, createOtherUser, createTestUser, type Handler, type TestServer } from "../testkit.ts";

let t: TestServer;
let core: typeof import("./core.ts");
let insertCards: typeof import("./sql.ts")["insertCards"];
let handlers: { queue: Handler; attempt: Handler };

beforeAll(async () => {
  t = await bootTestServer();
  mock.module("../llm/gateway.ts", () => ({ chatStream: async () => { throw new Error("unused"); }, chatJson: async () => ({ data: { score: 0.5, feedback: "ok" }, costMicros: 0n }) }));
  core = await import("./core.ts");
  insertCards = (await import("./sql.ts")).insertCards;
  const { learnRoutes } = await import("./routes.ts");
  handlers = { queue: learnRoutes["/api/practice/queue"].GET, attempt: learnRoutes["/api/practice/attempt"].POST };
});

async function seed(uid: string, kind: "mcq" | "free"): Promise<{ topicId: string; qid: string }> {
  const [topic] = await t.sql`INSERT INTO topics (user_id, slug, name, domain) VALUES (${uid}, ${`t-${crypto.randomUUID()}`}, 'T', 'math') RETURNING id`;
  const answer = kind === "mcq" ? { index: 1 } : { rubric: "secret rubric", model: "model answer" };
  const choices = kind === "mcq" ? ["a", "b", "c", "d"] : null;
  const [q] = await t.sql`
    INSERT INTO questions (user_id, topic_id, kind, stem, choices, answer, explanation)
    VALUES (${uid}, ${topic.id}, ${kind}, 's', ${JSON.stringify(choices)}::text::jsonb, ${JSON.stringify(answer)}::text::jsonb, 'because') RETURNING id`;
  await insertCards(t.sql, uid, [q.id]);
  return { topicId: topic.id, qid: q.id };
}

function keysOf(v: unknown, out: string[] = []): string[] {
  if (Array.isArray(v)) v.forEach((x) => keysOf(x, out));
  else if (typeof v === "object" && v !== null) for (const [k, x] of Object.entries(v)) (out.push(k), keysOf(x, out));
  return out;
}

test("qualityOf + scheduleSm2 table", () => {
  const now = new Date("2026-01-01T00:00:00Z");
  const card = { ef: 2.5, intervalD: 0, reps: 0, lapses: 0, dueAt: now };
  const rows: { name: string; card: typeof card; s: number; c: number; q: number; reps: number; interval: number; lapses: number; ef: number }[] = [
    { name: "first success", card, s: 1, c: 50, q: 4, reps: 1, interval: 1, lapses: 0, ef: 2.5 },
    { name: "second success", card: { ...card, reps: 1, intervalD: 1 }, s: 1, c: 80, q: 5, reps: 2, interval: 6, lapses: 0, ef: 2.6 },
    { name: "third success", card: { ...card, reps: 2, intervalD: 6 }, s: 0.7, c: 50, q: 3, reps: 3, interval: 14, lapses: 0, ef: 2.36 },
    { name: "lapse", card: { ...card, reps: 3, intervalD: 14 }, s: 0.2, c: 20, q: 2, reps: 0, interval: 1, lapses: 1, ef: 2.18 },
    { name: "unsure error", card, s: 0, c: 50, q: 1, reps: 0, interval: 1, lapses: 1, ef: 1.96 },
    { name: "confident error", card, s: 0, c: 90, q: 0, reps: 0, interval: 1, lapses: 1, ef: 1.7 },
    { name: "ef floor", card: { ...card, ef: 1.3, reps: 2, intervalD: 6 }, s: 0.6, c: 10, q: 3, reps: 3, interval: 8, lapses: 0, ef: 1.3 },
    { name: "boundary .85", card, s: 0.85, c: 69, q: 4, reps: 1, interval: 1, lapses: 0, ef: 2.5 },
  ];
  for (const r of rows) {
    const q = core.qualityOf(r.s, r.c);
    const n = core.scheduleSm2(r.card, q, now);
    expect([r.name, q, n.reps, n.intervalD, n.lapses, Math.round(n.ef * 100) / 100]).toEqual([r.name, r.q, r.reps, r.interval, r.lapses, r.ef]);
    expect(n.dueAt.getTime()).toBe(now.getTime() + r.interval * 86_400_000);
  }
});

test("queue never exposes answer fields; attempt does, after grading", async () => {
  await t.reset();
  const u = await createTestUser();
  const mcq = await seed(u.id, "mcq");
  const free = await seed(u.id, "free");
  const res = await callRoute(handlers.queue, "GET", "/api/practice/queue?limit=10");
  expect(res.status).toBe(200);
  const list = await res.json();
  expect(list).toHaveLength(2);
  const keys = keysOf(list);
  for (const k of ["answer", "explanation", "rubric", "model"]) expect(keys).not.toContain(k);
  const body = { questionId: free.qid, response: "my answer", confidence: 60, latencyMs: 1000 };
  const a = await (await callRoute(handlers.attempt, "POST", "/api/practice/attempt", { body })).json();
  expect(a.answer).toEqual({ kind: "free", model: "model answer" });
  expect(a).toMatchObject({ score: 0.5, correct: false, feedback: "ok", explanation: "because" });
  expect(JSON.stringify(a)).not.toContain("secret rubric");
  const other = await createOtherUser();
  const foreign = await seed(other.id, "mcq");
  const miss = await callRoute(handlers.attempt, "POST", "/api/practice/attempt", { body: { questionId: foreign.qid, choice: 1, confidence: 50, latencyMs: 5 } });
  expect(miss.status).toBe(404);
});

test("three attempts roll up into the topic", async () => {
  await t.reset();
  const u = await createTestUser();
  const { topicId, qid } = await seed(u.id, "mcq");
  for (const [choice, confidence] of [[1, 80], [0, 80], [1, 50]] as const) {
    const r = await callRoute(handlers.attempt, "POST", "/api/practice/attempt", { body: { questionId: qid, choice, confidence, latencyMs: 10 } });
    expect(r.status).toBe(200);
  }
  const [row] = await t.sql`SELECT attempts, correct, mastery, conf_err_sum FROM topics WHERE id = ${topicId}`;
  const expected = [1, 0, 1].reduce((m, s) => core.nextMastery(m, s), 0);
  expect(row.attempts).toBe(3);
  expect(row.correct).toBe(2);
  expect(Math.abs(row.mastery - expected)).toBeLessThan(1e-6);
  expect(Math.abs(row.conf_err_sum - (0.2 + 0.8 + 0.5))).toBeLessThan(1e-5);
  const [day] = await t.sql`SELECT attempts, reviews FROM daily_activity WHERE user_id = ${u.id}`;
  expect([day.attempts, day.reviews]).toEqual([3, 1]);
});
