import { AttemptRequest, QueueQuery, type AttemptResponse } from "../../shared/api.ts";
import { CodeSpec, type CodeTestResult } from "../../shared/code.ts";
import { codeFeedback, scoreTests } from "../code/core.ts";
import { runInSandbox } from "../code/sandbox.ts";
import { Settings, SettingsPatch, mergeSettings } from "../../shared/settings.ts";
import { listModels } from "../llm/core.ts";
import { HttpError, json, route } from "../http.ts";
import { chatJson } from "../llm/gateway.ts";
import { GradeOutput, CORRECT_AT, StoredAnswer, StoredCitations, buildGradePrompt, loadSettings, queueLimit, toAttemptAnswer, toQuestionPublic } from "./core.ts";
import { countReviewsToday, findQuestion, listDueQuestions, recordAttempt, updateSettings } from "./sql.ts";

const getSettings = route({ auth: true }, async (c) => json(loadSettings(c.user)));

const putSettings = route({ auth: true, body: SettingsPatch }, async (c) => {
  const next = Settings.safeParse(mergeSettings(loadSettings(c.user), c.body));
  if (!next.success) throw new HttpError(400, "bad_request");
  // SEC: a newly chosen model must be one of the selectable models
  const m = next.data.model;
  if (c.body.model !== undefined && m !== null && !listModels().some((x) => x.id === m)) throw new HttpError(400, "model_not_allowed");
  await updateSettings(c.user.id, next.data);
  return json(next.data);
});

const queue = route({ entitled: true }, async (c) => {
  const q = QueueQuery.safeParse(Object.fromEntries(new URL(c.req.url).searchParams));
  if (!q.success) throw new HttpError(400, "bad_request");
  const settings = loadSettings(c.user);
  if (!settings.srs.enabled) return json([]);
  const limit = queueLimit(settings, await countReviewsToday(c.user.id), q.data.limit);
  if (limit === 0) return json([]);
  return json((await listDueQuestions(c.user.id, limit)).map(toQuestionPublic));
});

const attempt = route({ entitled: true, body: AttemptRequest, rate: { key: "attempt", cap: 60, perMin: 60 } }, async (c) => {
  const uid = c.user.id;
  const row = await findQuestion(uid, c.body.questionId);
  if (!row) throw new HttpError(404, "not_found");
  const stored = StoredAnswer.parse(row.answer);
  let score = 0;
  let feedback: string | null = null;
  let tests: CodeTestResult[] = [];
  if (row.kind === "mcq") {
    if (c.body.choice === undefined || !("index" in stored)) throw new HttpError(400, "bad_request");
    score = c.body.choice === stored.index ? 1 : 0;
  } else if (row.kind === "code") {
    // SEC: libraries and hidden tests come from the stored question; the client sends only its code
    if (!c.body.response?.trim() || !("tests" in stored)) throw new HttpError(400, "bad_request");
    const r = await runInSandbox(CodeSpec.parse(row.code_spec).libraries, c.body.response, stored.tests);
    tests = r.run.tests;
    score = scoreTests(tests);
    feedback = codeFeedback(r.run);
  } else {
    if (!c.body.response?.trim() || !("rubric" in stored)) throw new HttpError(400, "bad_request");
    const p = buildGradePrompt(row.stem, stored, c.body.response);
    const g = await chatJson({ who: { uid, plan: c.plan, capMicros: c.capMicros }, model: { system: "grade" }, kind: "grade", system: p.system, user: p.user, schema: GradeOutput, maxTokens: 400 });
    score = g.data.score;
    feedback = g.data.feedback;
  }
  const now = new Date();
  const due = await recordAttempt({ uid, topicId: row.topic_id, questionId: row.id, score, confidence: c.body.confidence, latencyMs: c.body.latencyMs, response: row.kind === "mcq" ? null : (c.body.response ?? null), srsEnabled: loadSettings(c.user).srs.enabled }, now);
  const body: AttemptResponse = { score, correct: score >= CORRECT_AT, feedback, answer: toAttemptAnswer(row.kind, stored, tests), explanation: row.explanation, citations: StoredCitations.parse(row.citations), nextDueAt: due ? due.toISOString() : null };
  return json(body);
});

export const learnRoutes = {
  "/api/settings": { GET: getSettings, PUT: putSettings },
  "/api/practice/queue": { GET: queue },
  "/api/practice/attempt": { POST: attempt },
};
