import { z } from "zod";
import { GenerateRequest, PRACTICE_SET_SIZE, type GenerateResponse, type PracticeSetSummary, type QuestionPublic } from "../../shared/api.ts";
import { CODE_LIBRARIES } from "../../shared/code.ts";
import type { SQL } from "bun";
import { HttpError, json, route } from "../http.ts";
import { sql } from "../db.ts";
import { loadSettings, resolveModel, toQuestionPublic } from "../learn/core.ts";
import { insertCards } from "../learn/sql.ts";
import { retrievePapers } from "../lit/openalex.ts";
import { chatJson } from "../llm/gateway.ts";
import { localProfile } from "../profile.ts";
import { findStyleProfile } from "../styles/sql.ts";
import { upsertTopics } from "../topics/sql.ts";
import { GenOut, buildGenPrompt, normalizeQuestions } from "./core.ts";
import { deletePracticeSet, findPracticeSet, insertPracticeSet, insertQuestions, listPracticeSets, removePracticeSet } from "./sql.ts";

const IdParams = z.strictObject({ id: z.uuid() });
const SETS_LIMIT = 200;

type SetRequest = { uid: string; settings: ReturnType<typeof loadSettings>; topic: string; styleId: string | null; model?: string };

// O(one model call) plus one transaction
// INV: the model is called before the transaction opens, so a failed or slow generation never holds the database; replacing runs inside the same transaction as the insert, so a regenerated set swaps in whole or not at all
// INV: a code question's reference solution is stored without running it. The learner's machine runs the hidden tests, and the result is self-assessment.
async function generateSet(r: SetRequest, replacing?: (tx: SQL) => Promise<void>): Promise<GenerateResponse> {
  const style = r.styleId ? await findStyleProfile(r.uid, r.styleId) : null;
  if (r.styleId && !style) throw new HttpError(404, "not_found");
  const papers = await retrievePapers(r.topic, 3);
  const codeLibs = CODE_LIBRARIES;
  const out = await chatJson({
    who: { uid: r.uid },
    model: resolveModel(r.settings, r.model),
    kind: "gen",
    system: buildGenPrompt(r.settings, papers, style, codeLibs),
    user: r.topic,
    schema: GenOut,
    maxTokens: 700 * PRACTICE_SET_SIZE + 1500,
  });
  const qs = normalizeQuestions(out.data, papers, codeLibs);
  if (qs.length !== PRACTICE_SET_SIZE) throw new HttpError(502, "llm_bad_output");
  const { setId, topicId, rows } = await sql.begin(async (tx) => {
    const [id] = await upsertTopics(tx, r.uid, [out.data.topic], []);
    if (!id) throw new HttpError(502, "llm_bad_output");
    const inserted = await insertQuestions(tx, r.uid, id, r.styleId, qs);
    await insertCards(tx, r.uid, inserted.map((q) => q.id));
    const set = await insertPracticeSet(tx, r.uid, id, r.styleId, r.topic, inserted.map((q) => q.id));
    if (replacing) await replacing(tx);
    return { setId: set, topicId: id, rows: inserted };
  });
  const questions: QuestionPublic[] = rows.map(toQuestionPublic);
  return { setId, topicId, grounded: papers.length > 0, questions };
}

const generate = route({ body: GenerateRequest, rate: { key: "gen", cap: 10, perMin: 10 } }, async (c) => {
  const user = await localProfile();
  return json(await generateSet({ uid: user.id, settings: loadSettings(user), topic: c.body.topic, styleId: c.body.styleId ?? null, ...(c.body.model ? { model: c.body.model } : {}) }));
});

const listSets = route({}, async () => {
  const uid = (await localProfile()).id;
  const rows = await listPracticeSets(uid, SETS_LIMIT);
  const body: PracticeSetSummary[] = rows.map((r) => ({ id: r.id, topicId: r.topic_id, topic: r.topic, request: r.request, styleId: r.style_id, createdAt: r.created_at.toISOString(), questions: r.questions, answered: r.answered }));
  return json(body);
});

// SEC: removes the set's questions and the progress that came from them; another user's set is 404
const removeSet = route({}, async (c) => {
  const p = IdParams.safeParse({ id: c.params.id });
  if (!p.success || !(await deletePracticeSet((await localProfile()).id, p.data.id))) throw new HttpError(404, "not_found");
  return new Response(null, { status: 204 });
});

// INV: the new set uses the old set's topic text and style (Standard if that style was deleted); the old set is removed only once the new one is stored
// INV: if the old set is gone by the time the new one is stored (a second click, another window), the transaction rolls back and nothing is added
const regenerateSet = route({ rate: { key: "gen", cap: 10, perMin: 10 } }, async (c) => {
  const p = IdParams.safeParse({ id: c.params.id });
  const user = await localProfile();
  const old = p.success ? await findPracticeSet(user.id, p.data.id) : null;
  if (!old) throw new HttpError(404, "not_found");
  const replacing = async (tx: SQL): Promise<void> => {
    if (!(await removePracticeSet(tx, user.id, old.id))) throw new HttpError(404, "not_found");
  };
  return json(await generateSet({ uid: user.id, settings: loadSettings(user), topic: old.request, styleId: old.style_id }, replacing));
});

export const genRoutes = {
  "/api/questions/generate": { POST: generate },
  "/api/practice/sets": { GET: listSets },
  "/api/practice/sets/:id": { DELETE: removeSet },
  "/api/practice/sets/:id/regenerate": { POST: regenerateSet },
};
