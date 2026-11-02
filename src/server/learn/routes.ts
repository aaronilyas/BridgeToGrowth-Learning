import { AttemptRequest, QueueQuery, type AttemptResponse } from "../../shared/api.ts";
import type { CodeTestResult } from "../../shared/code.ts";
import { codeFeedback, sameTestNames, scoreTests } from "../../shared/codeGrade.ts";
import { Settings, SettingsPatch, mergeSettings } from "../../shared/settings.ts";
import { HttpError, json, route } from "../http.ts";
import { connectedProviderIds } from "../llm/providers/registry.ts";
import { chatJson } from "../llm/gateway.ts";
import { localProfile } from "../profile.ts";
import { GradeOutput, CORRECT_AT, StoredAnswer, StoredCitations, buildGradePrompt, loadSettings, queueLimit, toAttemptAnswer, toQuestionPublic } from "./core.ts";
import { countReviewsToday, findQuestion, listDueQuestions, recordAttempt, updateSettings } from "./sql.ts";

const getSettings = route({}, async () => {
  const connected = await connectedProviderIds();
  const next = Settings.safeParse(mergeSettings(loadSettings(await localProfile()), {}, connected));
  if (!next.success) throw new HttpError(500, "internal");
  return json(next.data);
});

const putSettings = route({ body: SettingsPatch }, async (c) => {
  const user = await localProfile();
  const connected = await connectedProviderIds();
  const next = Settings.safeParse(mergeSettings(loadSettings(user), c.body, connected));
  if (!next.success) throw new HttpError(400, "bad_request");
  await updateSettings(user.id, next.data);
  return json(next.data);
});

const queue = route({}, async (c) => {
  const user = await localProfile();
  const q = QueueQuery.safeParse(Object.fromEntries(new URL(c.req.url).searchParams));
  if (!q.success) throw new HttpError(400, "bad_request");
  const settings = loadSettings(user);
  if (!settings.srs.enabled) return json([]);
  const limit = queueLimit(settings, await countReviewsToday(user.id), q.data.limit);
  if (limit === 0) return json([]);
  return json((await listDueQuestions(user.id, limit)).map(toQuestionPublic));
});

const attempt = route({ body: AttemptRequest, rate: { key: "attempt", cap: 60, perMin: 60 } }, async (c) => {
  const user = await localProfile();
  const uid = user.id;
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
    // SEC: the learner's machine ran these tests. The names must match the stored tests. The server records the reported outcomes and does not run Python. A client can forge a pass; the result is self-assessment.
    if (!c.body.response?.trim() || !("tests" in stored) || !c.body.codeRun) throw new HttpError(400, "bad_request");
    if (!sameTestNames(stored.tests, c.body.codeRun.tests)) throw new HttpError(400, "bad_request");
    tests = [...c.body.codeRun.tests];
    score = scoreTests(tests);
    feedback = codeFeedback({ stdout: "", stderr: "", error: c.body.codeRun.error, tests });
  } else {
    if (!c.body.response?.trim() || !("rubric" in stored)) throw new HttpError(400, "bad_request");
    const p = buildGradePrompt(row.stem, stored, c.body.response);
    const g = await chatJson({ who: { uid }, model: { system: "grade" }, kind: "grade", system: p.system, user: p.user, schema: GradeOutput, maxTokens: 400 });
    score = g.data.score;
    feedback = g.data.feedback;
  }
  const now = new Date();
  const due = await recordAttempt({ uid, topicId: row.topic_id, questionId: row.id, score, confidence: c.body.confidence, latencyMs: c.body.latencyMs, response: row.kind === "mcq" ? null : (c.body.response ?? null), srsEnabled: loadSettings(user).srs.enabled }, now);
  const body: AttemptResponse = { score, correct: score >= CORRECT_AT, feedback, answer: toAttemptAnswer(row.kind, stored, tests), explanation: row.explanation, citations: StoredCitations.parse(row.citations), nextDueAt: due ? due.toISOString() : null };
  return json(body);
});

export const learnRoutes = {
  "/api/settings": { GET: getSettings, PUT: putSettings },
  "/api/practice/queue": { GET: queue },
  "/api/practice/attempt": { POST: attempt },
};
