import { GenerateRequest, type QuestionPublic } from "../../shared/api.ts";
import { HttpError, json, route } from "../http.ts";
import { sql } from "../db.ts";
import { loadSettings, resolveModel, toQuestionPublic } from "../learn/core.ts";
import { insertCards } from "../learn/sql.ts";
import { retrievePapers } from "../lit/openalex.ts";
import { chatJson } from "../llm/gateway.ts";
import { findStyleProfile } from "../styles/sql.ts";
import { upsertTopics } from "../topics/sql.ts";
import { GenOut, buildGenPrompt, normalizeQuestions, splitCounts } from "./core.ts";
import { insertQuestions } from "./sql.ts";

const generate = route({ entitled: true, body: GenerateRequest, rate: { key: "gen", cap: 10, perMin: 10 } }, async (c) => {
  const uid = c.user.id;
  const settings = loadSettings(c.user);
  if (c.body.count > settings.bite.questionsPerSession) throw new HttpError(400, "bad_request");
  const style = c.body.styleId ? await findStyleProfile(uid, c.body.styleId) : null;
  if (c.body.styleId && !style) throw new HttpError(404, "not_found");
  const model = resolveModel(settings, c.plan, c.body.model);
  const want = splitCounts(c.body.count, c.body.kind, settings.recall.freeResponseRatio);
  const papers = await retrievePapers(c.body.topic, 3);
  const r = await chatJson({
    who: { uid, plan: c.plan, capMicros: c.capMicros },
    model,
    kind: "gen",
    system: buildGenPrompt(settings, want, papers, style),
    user: c.body.topic,
    schema: GenOut,
    maxTokens: 700 * c.body.count + 300,
  });
  const qs = normalizeQuestions(r.data, want, papers);
  if (qs.length === 0) throw new HttpError(502, "llm_bad_output");
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
