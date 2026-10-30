import { beforeAll, expect, mock, test } from "bun:test";
import { bootTestServer, callRoute, createOtherUser, createTestUser, type Handler, type TestServer } from "../testkit.ts";

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

test("another user's lesson is 404 for the local user", async () => {
  await t.reset();
  const local = await createTestUser();
  const other = await createOtherUser();
  const plan = { title: "T", topic: { name: "X", domain: "math" }, related: [], steps: [{ title: "s", summary: "s" }] };
  const [foreignTopic] = await t.sql`INSERT INTO topics (user_id, slug, name, domain) VALUES (${other.id}, 'x', 'X', 'math') RETURNING id`;
  const [foreign] = await t.sql`INSERT INTO lessons (user_id, topic_id, title, plan, model) VALUES (${other.id}, ${foreignTopic.id}, 'T', ${JSON.stringify(plan)}::text::jsonb, 'm') RETURNING id`;
  const hidden = `?id=${foreign.id}`;
  expect((await callRoute(h.get, "GET", `/x${hidden}`)).status).toBe(404);
  expect((await callRoute(h.step, "POST", `/x${hidden}`, { body: {} })).status).toBe(404);
  expect((await callRoute(h.chat, "POST", `/x${hidden}`, { body: { message: "hi" } })).status).toBe(404);
  const [ownTopic] = await t.sql`INSERT INTO topics (user_id, slug, name, domain) VALUES (${local.id}, 'y', 'Y', 'math') RETURNING id`;
  const [own] = await t.sql`INSERT INTO lessons (user_id, topic_id, title, plan, model) VALUES (${local.id}, ${ownTopic.id}, 'T', ${JSON.stringify(plan)}::text::jsonb, 'm') RETURNING id`;
  expect((await callRoute(h.get, "GET", `/x?id=${own.id}`)).status).toBe(200);
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
