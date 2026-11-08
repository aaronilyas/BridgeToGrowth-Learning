import { SQL } from "bun";
import { expect, test } from "bun:test";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MIGRATIONS, migrateDatabase } from "../../scripts/migrate.ts";

// O(1)
async function countMigrationLedger(path: string): Promise<number> {
  const db = new SQL(`sqlite://${path}`);
  try {
    const rows = await db`SELECT count(*) AS n FROM schema_migrations LIMIT 1` as { n: number }[];
    return rows[0]?.n ?? 0;
  } finally {
    await db.close();
  }
}

test("migrations apply once and reject a changed checksum", async () => {
  const path = join(mkdtempSync(join(tmpdir(), "btg-mig-")), "btg.sqlite");
  await migrateDatabase(path);
  const first = await countMigrationLedger(path);
  expect(first).toBeGreaterThan(0);
  await migrateDatabase(path);
  expect(await countMigrationLedger(path)).toBe(first);
  const db = new SQL(`sqlite://${path}`);
  await db`UPDATE schema_migrations SET sha256 = '0' WHERE name = '0001_init.sql'`;
  await db.close();
  await expect(migrateDatabase(path)).rejects.toThrow("checksum mismatch: 0001_init.sql");
});

test("the embedded migration list matches db/migrations in order", () => {
  const files = readdirSync(join(import.meta.dir, "..", "..", "db", "migrations")).filter((f) => f.endsWith(".sql")).sort();
  expect(MIGRATIONS.map(([name]) => name)).toEqual(files);
});

test("0006 folds steps into the transcript in reading order and renames the plan and settings keys", async () => {
  const path = join(mkdtempSync(join(tmpdir(), "btg-mig-")), "btg.sqlite");
  const db = new SQL(`sqlite://${path}`);
  try {
    await db`PRAGMA foreign_keys=ON`;
    for (const [, source] of MIGRATIONS.slice(0, 5)) await db.unsafe(source);
    await db.unsafe(`
      INSERT INTO users (id, email, settings) VALUES ('u', 'a@b.c', '{"level":"grad","bite":{"stepsPerLesson":6,"maxWordsPerStep":120,"questionsPerSession":5}}');
      INSERT INTO topics (id, user_id, slug, name, domain) VALUES ('t', 'u', 's', 'S', 'math');
      INSERT INTO lessons (id, user_id, topic_id, title, plan, model, created_at) VALUES ('l', 'u', 't', 'T', '{"title":"T","topic":{"name":"S","domain":"math"},"related":[],"steps":[{"title":"A","summary":"a"},{"title":"B","summary":"b"}]}', 'm', 5);
      INSERT INTO questions (id, user_id, topic_id, lesson_id, kind, stem, choices, answer, explanation, created_at) VALUES ('q0', 'u', 't', 'l', 'mcq', 's', '["a","b","c","d"]', '{"index":0}', 'e', 10), ('q1', 'u', 't', 'l', 'mcq', 's', '["a","b","c","d"]', '{"index":0}', 'e', 20);
      INSERT INTO attempts (user_id, question_id, topic_id, score, confidence, latency_ms, is_review) VALUES ('u', 'q0', 't', 1, 50, 1, 0), ('u', 'q1', 't', 1, 50, 1, 0);
      INSERT INTO lesson_steps (lesson_id, idx, content) VALUES
        ('l', 0, '{"title":"A","explanationMd":"**Prerequisites:** algebra. Body of A.","keyIdea":"Idea A","example":null,"citations":[],"questionId":"q0"}'),
        ('l', 1, '{"title":"B","explanationMd":"Body of B.","keyIdea":"**Key:** B","example":"Worked B","citations":[{"n":1,"paperId":"p","doi":null,"title":"t","year":null}],"questionId":"q1"}');
      INSERT INTO conversations (id, user_id, lesson_id) VALUES ('c', 'u', 'l');
      INSERT INTO messages (conv_id, role, content, step_idx) VALUES ('c', 'user', 'on B', 1), ('c', 'user', 'unanchored', NULL), ('c', 'user', 'on A', 0), ('c', 'assistant', 'unknown step', 9);
    `);
    await db.unsafe(MIGRATIONS[5]?.[1] ?? "");
    const rows = await db`SELECT role, content, citations, topic_idx, check_id, finishes FROM messages ORDER BY id` as { role: string; content: string; citations: string; topic_idx: number | null; check_id: string | null; finishes: number }[];
    expect(rows.map((r) => [r.role, r.topic_idx, r.check_id, r.finishes])).toEqual([
      ["assistant", 0, "q0", 0], ["user", 0, null, 0],
      ["assistant", 1, "q1", 1], ["user", 1, null, 0],
      ["user", null, null, 0], ["assistant", null, null, 0],
    ]);
    expect(rows.map((r) => r.content).slice(1, 2)).toEqual(["on A"]);
    expect(rows[0]?.content).toBe("### A\n\nBody of A.\n\n**Key idea:** Idea A");
    expect(rows[2]?.content).toBe("### B\n\nBody of B.\n\n**Key:** B\n\n**Worked example**\n\nWorked B");
    expect(JSON.parse(rows[2]?.citations ?? "[]")).toHaveLength(1);
    const [lesson] = await db`SELECT plan FROM lessons` as { plan: string }[];
    const plan = JSON.parse(lesson?.plan ?? "{}");
    expect(plan.steps).toBeUndefined();
    expect(plan.outline).toEqual([{ title: "A", summary: "a" }, { title: "B", summary: "b" }]);
    const [user] = await db`SELECT settings FROM users WHERE id = 'u'` as { settings: string }[];
    expect(JSON.parse(user?.settings ?? "{}")).toEqual({ level: "grad", bite: { questionsPerSession: 5, topicsPerLesson: 6, maxWordsPerTurn: 120 } });
    expect(await db`SELECT name FROM sqlite_master WHERE name = 'lesson_steps'`).toHaveLength(0);
    await db`DELETE FROM questions WHERE id = 'q0'`;
    const [cleared] = await db`SELECT check_id FROM messages WHERE topic_idx = 0 AND role = 'assistant'` as { check_id: string | null }[];
    expect(cleared?.check_id).toBeNull();
  } finally {
    await db.close();
  }
});
