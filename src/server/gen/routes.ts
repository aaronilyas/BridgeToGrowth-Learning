import { GenerateRequest, PRACTICE_SET_SIZE, type QuestionPublic } from "../../shared/api.ts";
import { HttpError, json, route } from "../http.ts";
import { codeRuntime, runInSandbox } from "../code/sandbox.ts";
import { sql } from "../db.ts";
import { loadSettings, resolveModel, toQuestionPublic } from "../learn/core.ts";
import { insertCards } from "../learn/sql.ts";
import { retrievePapers } from "../lit/openalex.ts";
import { chatJson } from "../llm/gateway.ts";
import { findStyleProfile } from "../styles/sql.ts";
import { upsertTopics } from "../topics/sql.ts";
import { GenOut, buildGenPrompt, normalizeQuestions } from "./core.ts";
import { insertQuestions } from "./sql.ts";

const generate = route({ entitled: true, body: GenerateRequest, rate: { key: "gen", cap: 10, perMin: 10 } }, async (c) => {
  const uid = c.user.id;
  const settings = loadSettings(c.user);
  const style = c.body.styleId ? await findStyleProfile(uid, c.body.styleId) : null;
  if (c.body.styleId && !style) throw new HttpError(404, "not_found");
  const model = resolveModel(settings, c.body.model);
  const [papers, rt] = await Promise.all([retrievePapers(c.body.topic, 3), codeRuntime()]);
  const codeLibs = rt.enabled ? rt.libraries : null;
  const r = await chatJson({
    who: { uid, plan: c.plan, capMicros: c.capMicros },
    model,
    kind: "gen",
    system: buildGenPrompt(settings, papers, style, codeLibs),
    user: c.body.topic,
    schema: GenOut,
    maxTokens: 700 * PRACTICE_SET_SIZE + 1500,
  });
  const qs = normalizeQuestions(r.data, papers, codeLibs);
  if (qs.length !== PRACTICE_SET_SIZE) throw new HttpError(502, "llm_bad_output");
  // INV: a code question is stored only if its reference solution passes every hidden test in the sandbox
  for (const q of qs) {
    if (q.kind !== "code" || !q.code || !("tests" in q.answer)) continue;
    const check = await runInSandbox(q.code.libraries, q.answer.model, q.answer.tests);
    const failed = check.run.tests.filter((t) => !t.passed).length;
    if (check.run.error === null && failed === 0) continue;
    console.error(`gen: code exercise rejected, reference solution ${check.run.error === null ? `failed ${failed} of ${check.run.tests.length} tests` : "raised an error"}`);
    throw new HttpError(502, "llm_bad_output");
  }
  const { topicId, rows } = await sql.begin(async (tx) => {
    const [id] = await upsertTopics(tx, uid, [r.data.topic], []);
    if (!id) throw new HttpError(502, "llm_bad_output");
    const inserted = await insertQuestions(tx, uid, id, c.body.styleId ?? null, qs);
    await insertCards(tx, uid, inserted.map((q) => q.id));
    return { topicId: id, rows: inserted };
  });
  const questions: QuestionPublic[] = rows.map(toQuestionPublic);
  return json({ topicId, grounded: papers.length > 0, questions });
});

export const genRoutes = { "/api/questions/generate": { POST: generate } };
