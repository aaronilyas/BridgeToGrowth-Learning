import { beforeAll, expect, mock, test } from "bun:test";
import { bootTestServer, callRoute, createTestUser, type Handler, type TestServer } from "../testkit.ts";

let t: TestServer;
let h: { get: Handler; step: Handler; chat: Handler };
let upsertTopics: typeof import("../topics/sql.ts")["upsertTopics"];

beforeAll(async () => {
  t = await bootTestServer();
  const never = async (): Promise<never> => {
    throw new Error("llm must not be reached");
  };
  mock.module("../llm/gateway.ts", () => ({ chatJson: never, chatStream: never, startPricingRefresh: () => {} }));
  upsertTopics = (await import("../topics/sql.ts")).upsertTopics;
  const { teachRoutes } = await import("./routes.ts");
  const withParams = (fn: Handler, params: Record<string, string>): Handler => (req) => fn(Object.assign(req, { params }));
  const a = teachRoutes;
  h = {
    get: (req) => withParams(a["/api/lessons/:id"].GET, { id: new URL(req.url).searchParams.get("id") ?? "" })(req),
    step: (req) => withParams(a["/api/lessons/:id/steps/:idx"].POST, { id: new URL(req.url).searchParams.get("id") ?? "", idx: "0" })(req),
    chat: (req) => withParams(a["/api/lessons/:id/chat"].POST, { id: new URL(req.url).searchParams.get("id") ?? "" })(req),
  };
});

test("another user gets 404 on get, step and chat of a lesson", async () => {
  await t.reset();
  const a = await createTestUser();
  const b = await createTestUser();
  const [topic] = await t.sql`INSERT INTO topics (user_id, slug, name, domain) VALUES (${a.id}, 'x', 'X', 'math') RETURNING id`;
  const plan = { title: "T", topic: { name: "X", domain: "math" }, related: [], steps: [{ title: "s", summary: "s" }] };
  const [lesson] = await t.sql`INSERT INTO lessons (user_id, topic_id, title, plan, model) VALUES (${a.id}, ${topic.id}, 'T', ${JSON.stringify(plan)}::text::jsonb, 'm') RETURNING id`;
  const q = `?id=${lesson.id}`;
  expect((await callRoute(h.get, "GET", `/x${q}`, { cookie: b.cookie })).status).toBe(404);
  expect((await callRoute(h.step, "POST", `/x${q}`, { cookie: b.cookie, body: {} })).status).toBe(404);
  expect((await callRoute(h.chat, "POST", `/x${q}`, { cookie: b.cookie, body: { message: "hi" } })).status).toBe(404);
  expect((await callRoute(h.get, "GET", `/x${q}`, { cookie: a.cookie })).status).toBe(200);
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
