import { SQL } from "bun";
import { afterAll, beforeAll, expect, mock, test } from "bun:test";
import { unzipSync } from "fflate";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { z } from "zod";
import { MessageResponse as CurrentMessage } from "../shared/api.ts";
import { TEST_ORIGIN, callRoute, type Handler } from "./testkit.ts";

// The real v0.1.1 server, unpacked at test time and run against the same database file as this build.
// src/server/testdata/v0.1.1-source.zip was made with:
//   git archive --format=zip -9 v0.1.1 -- src/server src/shared scripts/migrate.ts db package.json ':(exclude)*.test.ts' ':(exclude)src/server/llm/providers/fixtures'

const REPO = join(import.meta.dir, "..", "..");
const UID = "00000000-0000-4000-8000-000000000001";
const PROMPT = "Teach me the idea please";
const TOPICS = [{ title: "First idea", summary: "Name the first idea." }, { title: "Second idea", summary: "Use the second idea." }, { title: "Third idea", summary: "Apply the third idea." }];

type Schema<T> = z.ZodType<T>;
type StepPublic = { idx: number; title: string; check: { id: string }; lastAttempt: unknown };
type LessonDetail = { id: string; plan: { steps: { title: string }[] }; steps: StepPublic[] };
type LegacyMessage = { id: string; role: string; content: string; stepIdx: number | null };
type Summary = { id: string; status: string };
type V011Settings = { level: string; srs: { newPerDay: number; maxReviewsPerDay: number; repetitions: number }; bite: { stepsPerLesson: number; maxWordsPerStep: number; questionsPerSession: number } };
type V011 = {
  open: (path: string) => Promise<void>;
  rawSettings: () => Promise<Record<string, unknown>>;
  settings: () => Promise<V011Settings>;
  parse: { success: (raw: unknown) => boolean };
  save: (raw: unknown) => Promise<void>;
  createLesson: () => Promise<string>;
  list: () => Promise<Summary[]>;
  lesson: (id: string) => Promise<LessonDetail>;
  messages: (id: string) => Promise<LegacyMessage[]>;
  step: (id: string, idx: number) => Promise<StepPublic>;
  chat: (id: string, message: string, stepIdx?: number) => Promise<void>;
  attempt: (questionId: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
};
type Turn = { id: string; role: string; content: string; topicIdx: number | null; check: { question: { id: string; stem: string }; lastAttempt: unknown } | null; finishes: boolean };

const tmp = mkdtempSync(join(tmpdir(), "btg-downgrade-"));
let v: V011;
let current: {
  open: (path: string) => Promise<void>;
  start: (id: string, reply: string) => Promise<void>;
  chat: (id: string, message: string, reply: string) => Promise<void>;
  messages: (id: string) => Promise<Turn[]>;
  detail: (id: string) => Promise<{ status: number; body: { plan: { outline: unknown[] } } }>;
  addLesson: () => Promise<string>;
  settings: () => Promise<{ bite: { topicsPerLesson: number; maxWordsPerTurn: number }; srs: { newPerDay: number; maxReviewsPerDay: number; repetitions: number } }>;
  saveTopics: (n: number) => Promise<void>;
};

let scratch = 0;
const scratchDb = (): string => join(tmp, `scratch-${scratch++}.sqlite`);
const CHECK = { kind: "mcq", stem: "Which word names the idea?", choices: ["right-one", "beta", "gamma", "delta"], answerIndex: 0, rubric: null, modelAnswer: null, explanation: "Because it is." } as const;

// O(1)
function body<T>(res: Response, schema: Schema<T>): Promise<T> {
  return res.json().then((value: unknown) => schema.parse(value));
}

// O(files)
// INV: runs v0.1.1's own modules; its gateway and paper search are stubbed so no model or network is reached
async function loadV011(): Promise<V011> {
  const root = join(tmp, "v0.1.1");
  const files = unzipSync(new Uint8Array(readFileSync(join(import.meta.dir, "testdata", "v0.1.1-source.zip"))));
  for (const [name, bytes] of Object.entries(files)) {
    if (name.endsWith("/")) continue;
    const path = join(root, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, bytes);
  }
  symlinkSync(join(REPO, "node_modules"), join(root, "node_modules"));
  const src = (p: string): string => join(root, "src", p);
  let stepNo = 0;
  mock.module(src("server/llm/gateway.ts"), () => ({
    chatJson: async (o: { kind: string }) => {
      if (o.kind === "lesson") return { data: { title: "Older lesson", topic: { name: `Topic ${crypto.randomUUID()}`, domain: "math" }, related: [], steps: TOPICS }, costMicros: 0n };
      if (o.kind === "step") {
        stepNo += 1;
        return { data: { explanationMd: `Explanation ${stepNo}.`, keyIdea: `Idea ${stepNo}`, example: null, check: CHECK }, costMicros: 0n };
      }
      throw new Error(`unexpected model call: ${o.kind}`);
    },
    chatStream: async (o: { onDone: (text: string) => Promise<unknown> }) => {
      await o.onDone("Reply from v0.1.1.");
      return new ReadableStream({ start(controller) { controller.close(); } });
    },
  }));
  mock.module(src("server/lit/openalex.ts"), () => ({ retrievePapers: async () => [] }));
  const db = await import(src("server/db.ts")) as { activateDatabase: (p: string) => Promise<void> };
  const { setRuntimeOrigin } = await import(src("server/localGuard.ts")) as { setRuntimeOrigin: (o: string) => void };
  setRuntimeOrigin(TEST_ORIGIN);
  const api = await import(src("shared/api.ts")) as Record<"LessonDetail" | "LessonSummary" | "MessageResponse" | "StepPublic", z.ZodType>;
  const settingsMod = await import(src("shared/settings.ts")) as { Settings: z.ZodType };
  const learn = await import(src("server/learn/core.ts")) as { loadSettings: (u: { settings: Record<string, unknown> }) => V011Settings };
  const learnSql = await import(src("server/learn/sql.ts")) as { findUserSettings: (uid: string) => Promise<Record<string, unknown>>; updateSettings: (uid: string, s: unknown) => Promise<void> };
  const teach = (await import(src("server/teach/routes.ts")) as { teachRoutes: Record<string, Record<string, Handler>> }).teachRoutes;
  const practice = (await import(src("server/learn/routes.ts")) as { learnRoutes: Record<string, Record<string, Handler>> }).learnRoutes;
  const route = (key: string, method: string): Handler => {
    const handler = (teach[key] ?? practice[key])?.[method];
    if (!handler) throw new Error(`no route ${method} ${key}`);
    return handler;
  };
  const withParams = (fn: Handler, params: Record<string, string>): Handler => (req) => fn(Object.assign(req, { params }));
  const ok = async (res: Response): Promise<Response> => {
    if (res.status >= 300) throw new Error(`v0.1.1 answered ${res.status}: ${await res.clone().text()}`);
    return res;
  };
  return {
    open: async (path) => {
      await db.activateDatabase(scratchDb());
      await db.activateDatabase(path);
    },
    rawSettings: () => learnSql.findUserSettings(UID),
    settings: async () => learn.loadSettings({ settings: await learnSql.findUserSettings(UID) }),
    parse: { success: (raw) => settingsMod.Settings.safeParse(raw).success },
    save: async (raw) => learnSql.updateSettings(UID, settingsMod.Settings.parse(raw)),
    createLesson: async () => {
      const res = await ok(await callRoute(route("/api/lessons", "POST"), "POST", "/api/lessons", { body: { prompt: PROMPT } }));
      return (await res.json() as { lessonId: string }).lessonId;
    },
    list: async () => {
      const res = await ok(await callRoute(route("/api/lessons", "GET"), "GET", "/api/lessons"));
      const rows = await res.json() as unknown[];
      for (const row of rows) api.LessonSummary.parse(row);
      return rows as Summary[];
    },
    lesson: async (id) => {
      const res = await ok(await callRoute(withParams(route("/api/lessons/:id", "GET"), { id }), "GET", "/x"));
      return body(res, api.LessonDetail as Schema<LessonDetail>);
    },
    messages: async (id) => {
      const res = await ok(await callRoute(withParams(route("/api/lessons/:id/messages", "GET"), { id }), "GET", "/x"));
      const rows = await res.json() as unknown[];
      for (const row of rows) api.MessageResponse.parse(row);
      return (rows as LegacyMessage[]).reverse();
    },
    step: async (id, idx) => {
      const res = await ok(await callRoute(withParams(route("/api/lessons/:id/steps/:idx", "POST"), { id, idx: String(idx) }), "POST", "/x", { body: {} }));
      return body(res, api.StepPublic as Schema<StepPublic>);
    },
    chat: async (id, message, stepIdx) => {
      await ok(await callRoute(withParams(route("/api/lessons/:id/chat", "POST"), { id }), "POST", "/x", { body: stepIdx === undefined ? { message } : { message, stepIdx } }));
    },
    attempt: async (questionId) => {
      await ok(await callRoute(route("/api/practice/attempt", "POST"), "POST", "/api/practice/attempt", { body: { questionId, choice: 0, confidence: 70, latencyMs: 10 } }));
    },
    remove: async (id) => {
      await ok(await callRoute(withParams(route("/api/lessons/:id", "DELETE"), { id }), "DELETE", "/x"));
    },
  };
}

let replyText = "";
let checkOut: typeof CHECK | null = null;

beforeAll(async () => {
  v = await loadV011();
  mock.module("./llm/gateway.ts", () => ({
    chatJson: async () => {
      if (checkOut === null) throw new Error("llm must not be reached");
      return { data: checkOut, costMicros: 0n };
    },
    chatStream: async (o: { onDone: (text: string, announce: () => void) => Promise<unknown> }) => {
      await o.onDone(replyText, () => {});
      return new ReadableStream({ start(controller) { controller.close(); } });
    },
    assertQuotaHeadroom: async () => {},
  }));
  process.env.BTG_DATA_DIR = tmp;
  const { activateDatabase, sql } = await import("./db.ts");
  (await import("./localGuard.ts")).setRuntimeOrigin(TEST_ORIGIN);
  const { teachRoutes } = await import("./teach/routes.ts");
  const { insertLesson } = await import("./teach/sql.ts");
  const { upsertTopics } = await import("./topics/sql.ts");
  const { loadSettings } = await import("./learn/core.ts");
  const { findUserSettings, updateSettings } = await import("./learn/sql.ts");
  const { Settings, mergeSettings } = await import("../shared/settings.ts");
  const withParams = (fn: Handler, params: Record<string, string>): Handler => (req) => fn(Object.assign(req, { params }));
  const turn = async (fn: Handler, id: string, reqBody: unknown, reply: string): Promise<void> => {
    replyText = reply;
    const res = await callRoute(withParams(fn, { id }), "POST", "/x", { body: reqBody });
    if (res.status !== 200) throw new Error(`this build answered ${res.status}: ${await res.text()}`);
  };
  current = {
    open: async (path) => {
      await activateDatabase(scratchDb());
      await activateDatabase(path);
    },
    start: (id, reply) => turn(teachRoutes["/api/lessons/:id/start"].POST, id, {}, reply),
    chat: (id, message, reply) => turn(teachRoutes["/api/lessons/:id/chat"].POST, id, { message }, reply),
    messages: async (id) => {
      const res = await callRoute(withParams(teachRoutes["/api/lessons/:id/messages"].GET, { id }), "GET", "/x?limit=500");
      if (res.status !== 200) throw new Error(`messages answered ${res.status}`);
      return ((await res.json() as unknown[]).map((row) => CurrentMessage.parse(row)) as Turn[]).reverse();
    },
    detail: async (id) => {
      const res = await callRoute(withParams(teachRoutes["/api/lessons/:id"].GET, { id }), "GET", "/x");
      return { status: res.status, body: await res.json() as { plan: { outline: unknown[] } } };
    },
    addLesson: async () => sql.begin(async (tx) => {
      const [topicId] = await upsertTopics(tx, UID, [{ name: `New ${crypto.randomUUID()}`, domain: "math" }], []);
      if (!topicId) throw new Error("topic missing");
      return insertLesson(tx, UID, topicId, { title: "Newer lesson", topic: { name: "N", domain: "math" }, related: [], outline: TOPICS }, [], "m");
    }),
    settings: async () => loadSettings({ settings: await findUserSettings(UID) }),
    saveTopics: async (n) => {
      const stored = await findUserSettings(UID);
      await updateSettings(UID, Settings.parse(mergeSettings(loadSettings({ settings: stored }), { bite: { topicsPerLesson: n } })), stored);
    },
  };
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

// O(rows)
async function withDb<T>(path: string, fn: (db: SQL) => Promise<T>): Promise<T> {
  const db = new SQL(`sqlite://${path}`);
  try {
    return await fn(db);
  } finally {
    await db.close();
  }
}

const V011_TABLES = ["messages", "lesson_steps", "lessons", "users", "questions", "cards", "attempts", "topics", "daily_activity"] as const;

// O(rows)
// INV: every table v0.1.1 reads, row for row, in a stable order
async function legacySnapshot(path: string): Promise<string> {
  return withDb(path, async (db) => {
    const out: Record<string, unknown> = {};
    for (const table of V011_TABLES) out[table] = await db.unsafe(`SELECT * FROM ${table} ORDER BY 1, 2`);
    out.ledger = await db`SELECT name, sha256 FROM schema_migrations WHERE name < '0006' ORDER BY name`;
    return JSON.stringify(out);
  });
}

// O(rows)
async function turnsSnapshot(path: string): Promise<string> {
  return withDb(path, async (db) => JSON.stringify(await db`SELECT * FROM lesson_turns ORDER BY id`));
}

// O(rows)
async function assertHealthy(path: string): Promise<void> {
  await withDb(path, async (db) => {
    expect(await db`PRAGMA foreign_key_check`).toEqual([]);
    expect((await db`PRAGMA integrity_check` as { integrity_check: string }[])[0]?.integrity_check).toBe("ok");
  });
}

// O(lessons)
// INV: exactly what the v0.1.1 page calls when a lesson opens: the list, the detail, the transcript, and each opened step
async function openEveryLessonOnV011(): Promise<void> {
  const lessons = await v.list();
  expect(lessons.length).toBeGreaterThan(0);
  for (const s of lessons) {
    const detail = await v.lesson(s.id);
    await v.messages(s.id);
    for (const step of detail.steps) expect((await v.step(s.id, step.idx)).check.id).toBe(step.check.id);
  }
}

// O(1)
async function seedOnV011(): Promise<{ midway: string; untouched: string }> {
  await v.save({ level: "grad", bite: { stepsPerLesson: 3, maxWordsPerStep: 120, questionsPerSession: 5 }, srs: { enabled: true, newPerDay: 40, maxReviewsPerDay: 300, repetitions: 8 } });
  const midway = await v.createLesson();
  const first = await v.step(midway, 0);
  await v.attempt(first.check.id);
  await v.chat(midway, "On the first step", 0);
  await v.step(midway, 1);
  await v.chat(midway, "On the second step", 1);
  await v.chat(midway, "Tied to no step");
  const untouched = await v.createLesson();
  return { midway, untouched };
}

test("a real v0.1.1 database upgrades, downgrades and re-upgrades with nothing lost", async () => {
  const path = join(tmp, "round-trip.sqlite");
  await v.open(path);
  const { midway, untouched } = await seedOnV011();
  const before = await legacySnapshot(path);

  // Upgrade: nothing v0.1.1 reads changes, and the lesson reads as one conversation.
  await current.open(path);
  expect(await legacySnapshot(path)).toBe(before);
  await assertHealthy(path);
  const firstRead = await current.messages(midway);
  expect(firstRead.map((t) => [t.role, t.topicIdx])).toEqual([
    ["assistant", 0], ["user", 0], ["assistant", 0],
    ["assistant", 1], ["user", 1], ["assistant", 1],
    ["user", null], ["assistant", null],
  ]);
  expect(firstRead[0]?.content).toBe("### First idea\n\nExplanation 1.\n\n**Key idea:** Idea 1");
  expect(firstRead[0]?.check?.lastAttempt).not.toBeNull();
  expect(firstRead[3]?.check?.lastAttempt).toBeNull();
  expect((await current.detail(midway)).body.plan.outline).toHaveLength(3);
  expect(await current.settings()).toMatchObject({ bite: { topicsPerLesson: 3, maxWordsPerTurn: 120 }, srs: { newPerDay: 20, maxReviewsPerDay: 200, repetitions: 6 } });

  // Running the upgrade again changes nothing.
  const once = await turnsSnapshot(path);
  await current.open(path);
  expect(await turnsSnapshot(path)).toBe(once);
  expect(await legacySnapshot(path)).toBe(before);

  // Work on this build: continue the old lesson, start a new one, with checks and a settings save.
  await current.chat(midway, "Carry on", "Going further. Why?\n[[lesson topic=2 action=continue]]");
  const fresh = await current.addLesson();
  await current.start(fresh, "Opening the lesson. What would change?\n[[lesson topic=1 action=continue]]");
  checkOut = CHECK;
  await current.chat(fresh, "Ready for a check", "See what you make of this one.\n[[lesson topic=2 action=check]]");
  await current.chat(fresh, "Another", "And one more.\n[[lesson topic=2 action=check]]");
  checkOut = null;
  await current.chat(fresh, "Thanks", "You can now name it.\n[[lesson topic=3 action=finish]]");
  await current.saveTopics(2);

  // Downgrade: real v0.1.1 opens the file and every lesson works, including ones started on this build.
  await v.open(path);
  await assertHealthy(path);
  await openEveryLessonOnV011();
  const raw = await v.rawSettings();
  expect(v.parse.success(raw)).toBe(true);
  expect(raw).toMatchObject({ level: "grad", bite: { stepsPerLesson: 2, maxWordsPerStep: 120, questionsPerSession: 5 }, srs: { newPerDay: 40, maxReviewsPerDay: 300, repetitions: 8 } });
  expect(await v.settings()).toMatchObject({ level: "grad", bite: { stepsPerLesson: 2, maxWordsPerStep: 120 }, srs: { newPerDay: 40 } });

  const simplified = await v.lesson(fresh);
  expect(simplified.plan.steps.map((s) => s.title)).toEqual(TOPICS.map((s) => s.title));
  expect(simplified.steps.map((s) => s.idx)).toEqual([1]);
  const said = await v.messages(fresh);
  expect(said.map((m) => m.content)).toEqual([
    "Opening the lesson. What would change?", "Ready for a check", "See what you make of this one.", "Another",
    "And one more.\n\n**Check from the tutor (answer it in Practice):** Which word names the idea?",
    "Thanks", "You can now name it.",
  ]);
  expect((await v.messages(midway)).map((m) => m.content)).toContain("Carry on");

  // A check asked on this build can be answered in v0.1.1, and each lesson takes a chat turn and a next step.
  const asked = simplified.steps[0];
  if (!asked) throw new Error("the check should appear as a step");
  await v.attempt(asked.check.id);
  await v.chat(fresh, "Answering in v0.1.1", asked.idx);
  await v.chat(untouched, "Opened the untouched lesson");
  await v.step(midway, 2);
  await v.chat(midway, "Last step", 2);
  const added = await v.createLesson();
  await v.save({ ...await v.settings(), bite: { stepsPerLesson: 5, maxWordsPerStep: 90, questionsPerSession: 4 } });

  // Re-upgrade: everything from both sides is present, once.
  const beforeReupgrade = await legacySnapshot(path);
  await current.open(path);
  expect(await legacySnapshot(path)).toBe(beforeReupgrade);
  await assertHealthy(path);
  const midwayAfter = await current.messages(midway);
  expect(midwayAfter.slice(0, firstRead.length).map((t) => t.content)).toEqual(firstRead.map((t) => t.content));
  const midwayText = midwayAfter.map((t) => t.content);
  expect(midwayText).toEqual([...firstRead.map((t) => t.content), "Carry on", "Going further. Why?", "### Third idea\n\nExplanation 3.\n\n**Key idea:** Idea 3", "Last step", "Reply from v0.1.1."]);
  const freshAfter = await current.messages(fresh);
  expect(freshAfter.map((t) => t.content)).toEqual(["Opening the lesson. What would change?", "Ready for a check", "See what you make of this one.", "Another", "And one more.", "Thanks", "You can now name it.", "Answering in v0.1.1", "Reply from v0.1.1."]);
  expect(freshAfter.filter((t) => t.check !== null)).toHaveLength(2);
  expect(freshAfter.find((t) => t.content === "See what you make of this one.")?.check?.lastAttempt).not.toBeNull();
  expect(freshAfter.find((t) => t.content === "You can now name it.")?.finishes).toBe(true);
  expect((await current.messages(untouched)).map((t) => t.content)).toEqual(["Opened the untouched lesson", "Reply from v0.1.1."]);
  expect((await current.detail(added)).status).toBe(200);
  expect(await current.settings()).toMatchObject({ bite: { topicsPerLesson: 5, maxWordsPerTurn: 90 } });

  const twice = await turnsSnapshot(path);
  await current.open(path);
  expect(await turnsSnapshot(path)).toBe(twice);

  // A second downgrade still works.
  await v.open(path);
  await openEveryLessonOnV011();
  expect(await v.settings()).toMatchObject({ bite: { stepsPerLesson: 5, maxWordsPerStep: 90 } });
});

test("answering the last step in v0.1.1 marks the lesson finished on re-upgrade", async () => {
  const path = join(tmp, "finish.sqlite");
  await v.open(path);
  await v.save({ bite: { stepsPerLesson: 3, maxWordsPerStep: 180, questionsPerSession: 8 } });
  const id = await v.createLesson();
  await v.attempt((await v.step(id, 0)).check.id);
  await v.attempt((await v.step(id, 1)).check.id);
  const last = await v.step(id, 2);
  await current.open(path);
  expect((await current.messages(id)).at(-1)?.finishes).toBe(false);
  await v.open(path);
  await v.attempt(last.check.id);
  await current.open(path);
  expect((await current.messages(id)).at(-1)?.finishes).toBe(true);
});

test("a lesson deleted in v0.1.1 stays deleted and leaves no turns behind", async () => {
  const path = join(tmp, "deleted.sqlite");
  await v.open(path);
  const { midway } = await seedOnV011();
  await current.open(path);
  await current.chat(midway, "One more", "Going on. Why?\n[[lesson topic=2 action=continue]]");
  await v.open(path);
  await v.remove(midway);
  await current.open(path);
  await assertHealthy(path);
  expect((await current.detail(midway)).status).toBe(404);
  const left = await withDb(path, async (db) => await db`SELECT count(*) AS n FROM lesson_turns t JOIN conversations c ON c.id = t.conv_id WHERE c.lesson_id = ${midway}` as { n: number }[]);
  expect(left[0]?.n).toBe(0);
});

test("a database created by this build opens in v0.1.1", async () => {
  const path = join(tmp, "fresh-build.sqlite");
  await current.open(path);
  const id = await current.addLesson();
  await current.start(id, "Hello. What do you already know?\n[[lesson topic=1 action=continue]]");
  await current.saveTopics(6);
  await v.open(path);
  await openEveryLessonOnV011();
  expect(await v.settings()).toMatchObject({ bite: { stepsPerLesson: 6 } });
  expect((await v.lesson(id)).steps).toEqual([]);
  expect((await v.messages(id)).map((m) => m.content)).toEqual(["Hello. What do you already know?"]);
});

test("a database already migrated by the retired 0006 is repaired and round-trips", async () => {
  const path = join(tmp, "after-0006.sqlite");
  await v.open(path);
  const { midway } = await seedOnV011();
  const retired = await Bun.file(join(REPO, "db", "retired", "0006_lesson_topics.sql")).text();
  const digest = new Bun.CryptoHasher("sha256").update(retired).digest("hex");
  await current.open(scratchDb());
  await v.open(scratchDb());
  await withDb(path, async (db) => {
    await db`PRAGMA foreign_keys=ON`;
    await db.begin(async (tx) => {
      await tx.unsafe(retired);
      await tx`INSERT INTO schema_migrations (name, sha256) VALUES ('0006_lesson_topics.sql', ${digest})`;
    });
    const [conv] = await db`SELECT id FROM conversations LIMIT 1` as { id: string }[];
    await db`INSERT INTO messages (conv_id, role, content, topic_idx) VALUES (${conv?.id ?? ""}, 'assistant', 'Written by the earlier build.', 1)`;
  });
  const folded = await withDb(path, async (db) => await db`SELECT id, role, content, topic_idx, check_id, finishes FROM messages ORDER BY id` as Record<string, unknown>[]);

  await current.open(path);
  await assertHealthy(path);
  const repaired = await withDb(path, async (db) => await db`SELECT id, role, content, topic_idx, check_id, finishes FROM lesson_turns ORDER BY id` as Record<string, unknown>[]);
  expect(repaired).toEqual(folded);
  expect((await current.messages(midway)).at(-1)?.content).toBe("Written by the earlier build.");
  expect(await current.settings()).toMatchObject({ bite: { topicsPerLesson: 3, maxWordsPerTurn: 120 } });

  await v.open(path);
  await assertHealthy(path);
  await openEveryLessonOnV011();
  expect(await v.settings()).toMatchObject({ level: "grad", bite: { stepsPerLesson: 3, maxWordsPerStep: 120 }, srs: { newPerDay: 40 } });
  const opened = await v.lesson(midway);
  expect(opened.steps.map((s) => s.title)).toEqual(["First idea", "Second idea"]);
  expect((await v.messages(midway)).map((m) => m.content)).toContain("Written by the earlier build.");
  await v.chat(midway, "Back on v0.1.1", 1);

  await current.open(path);
  const turns = await current.messages(midway);
  expect(turns.map((t) => t.content).slice(-3)).toEqual(["Written by the earlier build.", "Back on v0.1.1", "Reply from v0.1.1."]);
  const stable = await turnsSnapshot(path);
  await current.open(path);
  expect(await turnsSnapshot(path)).toBe(stable);
});
