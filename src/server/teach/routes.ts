import { z } from "zod";
import { ChatRequest, CreateLessonRequest, LessonPlan, type LessonCheck } from "../../shared/api.ts";
import { wrapBareMath } from "../../shared/math.ts";
import { sql } from "../db.ts";
import { HttpError, json, route } from "../http.ts";
import { loadSettings, resolveModel, StoredChoices, StoredCitations, type QuestionRow } from "../learn/core.ts";
import { listLatestAttempts } from "../learn/sql.ts";
import { retrievePapers } from "../lit/openalex.ts";
import { filterCitations, toCitations, type Paper } from "../lit/core.ts";
import { chatJson, chatStream } from "../llm/gateway.ts";
import { localProfile } from "../profile.ts";
import { slugOf } from "../topics/core.ts";
import { findMasteredSlugs, listMasteredNames, upsertTopics } from "../topics/sql.ts";
import { gatherSources } from "../sources/collect.ts";
import { MAX_PDF_BYTES, MAX_SOURCE_FILES } from "../sources/core.ts";
import { toNewQuestion, type NewQuestion } from "../gen/core.ts";
import type { Settings } from "../../shared/settings.ts";
import { CHAT_CONTEXT_MESSAGES, CheckOut, MAX_LESSON_CHECKS, OPENING_TURN, SourcedPlanOut, StoredPlan, TURN_MARK, allCitations, buildChatContext, buildCheckPrompt, buildPlanPrompt, buildTutorSystem, categoryOfCheck, currentTopic, KNOWN_TOPICS_IN_PROMPT, listPrereqs, maxOutlineTopics, normalizePlan, parseTutorTurn, pickLessonModel, planFromStored, revealAnswer, taughtText, toLessonCheck, toPublicPlan, tutorCheckBlock, unmetPrereqs } from "./core.ts";
import { CHECK_FALLBACK } from "./prompts.ts";
import { countLessonChecks, deleteLessonData, ensureConversation, findLesson, findLessonCheck, insertLesson, insertTutorTurn, listChecks, listLessons, listMessages, listPapers, type LessonRow } from "./sql.ts";

const IdParams = z.strictObject({ id: z.uuid() });
const ListQuery = z.strictObject({ limit: z.coerce.number().int().min(1).max(20).default(20) });
const LESSON_JSON_BYTES = 64 * 1024;
const LESSON_FORM_BYTES = MAX_SOURCE_FILES * MAX_PDF_BYTES + LESSON_JSON_BYTES;
const FORM_FIELDS: ReadonlySet<string> = new Set(["prompt", "model"]);
const TURN_MAX_TOKENS = 2000;
const MessagesQuery = z.strictObject({ before: z.string().regex(/^\d{1,18}$/).optional(), limit: z.coerce.number().int().min(1).max(500).default(50) });

function query(req: Request): Record<string, string> {
  return Object.fromEntries(new URL(req.url).searchParams);
}

async function requireLesson(uid: string, params: Record<string, string>): Promise<LessonRow> {
  const p = IdParams.safeParse({ id: params.id });
  const lesson = p.success ? await findLesson(uid, p.data.id) : null;
  if (!lesson) throw new HttpError(404, "not_found");
  return lesson;
}

function readPlan(lesson: LessonRow): StoredPlan {
  const p = StoredPlan.safeParse(planFromStored(lesson.plan));
  if (!p.success) throw new Error("stored plan is invalid");
  return p.data;
}

// O(checks)
async function publishChecks(uid: string, rows: QuestionRow[]): Promise<Map<string, LessonCheck>> {
  const latest = await listLatestAttempts(uid, rows.map((q) => q.id));
  const byId = new Map(latest.map((a) => [a.questionId, a]));
  return new Map(rows.map((q) => [q.id, toLessonCheck(q, byId.get(q.id) ?? null)]));
}

// O(1)
// SEC: the answer block is built only for a check of this lesson the learner has attempted
async function checkPrompt(uid: string, q: QuestionRow | null): Promise<string | null> {
  if (q === null) return null;
  const latest = (await listLatestAttempts(uid, [q.id]))[0] ?? null;
  const choices = q.choices === null ? null : StoredChoices.parse(q.choices);
  return tutorCheckBlock({ stem: q.stem, choices, attempt: latest, answer: latest === null ? null : revealAnswer(q), explanation: latest === null ? null : q.explanation });
}

type CheckJob = { uid: string; lesson: LessonRow; settings: Settings; plan: StoredPlan; model: string; topicIdx: number; papers: Paper[]; taught: string; signal: AbortSignal };

// O(1) plus one model call
// INV: null means no check this turn (the lesson's cap is reached, or the model failed); a turn is never lost to a failed check
// INV: a stop by the learner propagates, so the turn is dropped as it would be mid-stream
async function writeCheck(j: CheckJob): Promise<NewQuestion | null> {
  const asked = await countLessonChecks(j.uid, j.lesson.id);
  if (asked >= MAX_LESSON_CHECKS) return null;
  const category = categoryOfCheck(asked);
  try {
    const r = await chatJson({ who: { uid: j.uid }, model: j.model, kind: "check", system: buildCheckPrompt(j.settings, j.plan, j.topicIdx, category, j.papers), user: j.taught, schema: CheckOut, maxTokens: TURN_MAX_TOKENS, signal: j.signal });
    return toNewQuestion(r.data, category, j.papers);
  } catch (error) {
    if (j.signal.aborted) throw error;
    console.error("lesson: check generation failed");
    return null;
  }
}

// SEC: multipart fields are allowlisted and validated by the same strict schema as JSON; file parts are only accepted under "file"
async function readLessonInput(req: Request): Promise<{ body: CreateLessonRequest; files: File[] }> {
  let raw: unknown;
  const files: File[] = [];
  if ((req.headers.get("content-type") ?? "").toLowerCase().startsWith("multipart/form-data")) {
    const form = await req.formData().catch(() => null);
    if (!form) throw new HttpError(400, "bad_request");
    const fields: Record<string, string> = {};
    const urls: string[] = [];
    for (const k of new Set(form.keys())) {
      for (const v of form.getAll(k)) {
        if (k === "file" && v instanceof File) files.push(v);
        else if (k === "url" && typeof v === "string") urls.push(v);
        else if (FORM_FIELDS.has(k) && typeof v === "string" && !(k in fields)) fields[k] = v;
        else throw new HttpError(400, "bad_request");
      }
    }
    raw = { ...fields, ...(urls.length > 0 ? { urls } : {}) };
  } else {
    const text = await req.text();
    if (new TextEncoder().encode(text).length > LESSON_JSON_BYTES) throw new HttpError(413, "too_large");
    try {
      raw = JSON.parse(text);
    } catch {
      throw new HttpError(400, "bad_request");
    }
  }
  const r = CreateLessonRequest.safeParse(raw);
  if (!r.success || files.length > MAX_SOURCE_FILES) throw new HttpError(400, "bad_request");
  return { body: r.data, files };
}

// INV: attachments are read before any model call and passed to this one plan call only; the plan keeps at most short per-topic notes
const create = route({ raw: true, maxBody: LESSON_FORM_BYTES, rate: { key: "lesson", cap: 10, perMin: 10 } }, async (c) => {
  const user = await localProfile();
  const uid = user.id;
  const input = await readLessonInput(c.req);
  const settings = loadSettings(user);
  const model = resolveModel(settings, input.body.model);
  const [papers, known, sources] = await Promise.all([retrievePapers(input.body.prompt, 5), listMasteredNames(uid, KNOWN_TOPICS_IN_PROMPT), gatherSources(input.body.urls ?? [], input.files)]);
  const sourced = sources.count > 0;
  const call = { who: { uid }, model, kind: "lesson", system: buildPlanPrompt(settings, papers, known, sourced), user: input.body.prompt + sources.block, files: sources.files };
  const out = sourced ? (await chatJson({ ...call, schema: SourcedPlanOut, maxTokens: 5000 })).data : (await chatJson({ ...call, schema: LessonPlan, maxTokens: 2500 })).data;
  const plan = normalizePlan(out, settings.bite.topicsPerLesson, maxOutlineTopics(settings.bite.topicsPerLesson));
  const lessonId = await sql.begin(async (tx) => {
    const ids = await upsertTopics(tx, uid, [plan.topic, ...plan.related], plan.related.map((rel, i) => ({ src: 0, dst: i + 1, kind: rel.kind })));
    const topicId = ids[0];
    if (!topicId) throw new HttpError(502, "llm_bad_output");
    return insertLesson(tx, uid, topicId, plan, papers.map((p) => p.id), model);
  });
  return json({ lessonId, plan: toPublicPlan(plan), grounded: papers.length > 0 });
});

const list = route({}, async (c) => {
  const q = ListQuery.safeParse(query(c.req));
  if (!q.success) throw new HttpError(400, "bad_request");
  const rows = await listLessons((await localProfile()).id, q.data.limit);
  return json(rows.map((l) => ({ id: l.id, title: l.title, createdAt: l.created_at.toISOString(), status: l.status, lastActiveAt: l.last_active_at.toISOString() })));
});

const get = route({}, async (c) => {
  const uid = (await localProfile()).id;
  const lesson = await requireLesson(uid, c.params);
  const plan = readPlan(lesson);
  const [papers, mastered] = await Promise.all([listPapers(lesson.paper_ids), findMasteredSlugs(uid, listPrereqs(plan).map(slugOf))]);
  return json({ id: lesson.id, title: lesson.title, plan: toPublicPlan(plan), prerequisites: unmetPrereqs(plan, mastered), citations: allCitations(papers) });
});

type TurnInput = { message: string | null; checkId: string | null };

// O(context) plus the model calls
// INV: message null is the tutor's opening turn, which stores no learner message and only runs on an empty conversation
// INV: the model decides the topic and the action on its final line; the server only records them
async function streamTurn(c: { req: Request; params: Record<string, string> }, input: TurnInput): Promise<Response> {
  const user = await localProfile();
  const uid = user.id;
  const lesson = await requireLesson(uid, c.params);
  const settings = loadSettings(user);
  const plan = readPlan(lesson);
  const model = pickLessonModel(lesson.model, settings);
  const [papers, convId, recent, anchored] = await Promise.all([
    listPapers(lesson.paper_ids),
    ensureConversation(uid, lesson.id),
    listMessages(uid, lesson.id, null, CHAT_CONTEXT_MESSAGES),
    findLessonCheck(uid, lesson.id, input.checkId),
  ]);
  if (input.message === null && recent.length > 0) throw new HttpError(400, "bad_request");
  const topicIdx = currentTopic(recent);
  const system = buildTutorSystem(settings, { plan, topicIdx, opening: input.message === null, papers, checkBlock: await checkPrompt(uid, anchored) });
  const stream = await chatStream({
    who: { uid },
    model,
    kind: "chat",
    system,
    messages: buildChatContext([{ role: "user", content: input.message ?? OPENING_TURN }, ...recent.map((m) => ({ role: m.role, content: m.content }))]),
    maxTokens: TURN_MAX_TOKENS,
    signal: c.req.signal,
    hideFrom: TURN_MARK,
    onDone: async (raw, announceCheck) => {
      const turn = parseTutorTurn(raw, plan.outline.length);
      const f = filterCitations(turn.prose, papers.length);
      const body = wrapBareMath(f.text);
      if (body.trim() === "") throw new HttpError(502, "bad_output");
      const endTopic = turn.topicIdx ?? topicIdx;
      let check: NewQuestion | null = null;
      if (turn.action === "check") {
        announceCheck();
        check = await writeCheck({ uid, lesson, settings, plan, model, topicIdx: endTopic, papers, taught: taughtText(recent, body), signal: c.req.signal });
      }
      // A check the tutor promised but could not get still leaves the learner something to do.
      const text = turn.action === "check" && check === null ? `${body}\n\n${CHECK_FALLBACK}` : body;
      const citations = toCitations(f.used, papers);
      const finishes = turn.action === "finish";
      const q = await insertTutorTurn(uid, lesson, convId, { user: input.message, content: text, citations, topicIdx: endTopic, learnerTopicIdx: topicIdx, topic: plan.outline[endTopic] ?? null, finishes, check });
      return { text, citations, topicIdx: endTopic, finishes, check: q === null ? null : toLessonCheck(q, null) };
    },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-store" } });
}

const chat = route({ body: ChatRequest, rate: { key: "chat", cap: 20, perMin: 20 } }, (c) => streamTurn(c, { message: c.body.message, checkId: c.body.checkId ?? null }));

const start = route({ rate: { key: "chat", cap: 20, perMin: 20 } }, (c) => streamTurn(c, { message: null, checkId: null }));

const removeLesson = route({}, async (c) => {
  const p = IdParams.safeParse({ id: c.params.id });
  if (!p.success || !(await deleteLessonData((await localProfile()).id, p.data.id))) throw new HttpError(404, "not_found");
  return new Response(null, { status: 204 });
});

const messages = route({}, async (c) => {
  const uid = (await localProfile()).id;
  const lesson = await requireLesson(uid, c.params);
  const q = MessagesQuery.safeParse(query(c.req));
  if (!q.success) throw new HttpError(400, "bad_request");
  const rows = await listMessages(uid, lesson.id, q.data.before ?? null, q.data.limit);
  const checks = await publishChecks(uid, await listChecks(uid, rows.flatMap((m) => (m.check_id === null ? [] : [m.check_id]))));
  return json(rows.map((m) => ({ id: m.id, role: m.role, content: m.content, citations: StoredCitations.parse(m.citations), createdAt: m.created_at.toISOString(), topicIdx: m.topic_idx, check: m.check_id === null ? null : (checks.get(m.check_id) ?? null), finishes: m.finishes })));
});

export const teachRoutes = {
  "/api/lessons": { GET: list, POST: create },
  "/api/lessons/:id": { GET: get, DELETE: removeLesson },
  "/api/lessons/:id/start": { POST: start },
  "/api/lessons/:id/chat": { POST: chat },
  "/api/lessons/:id/messages": { GET: messages },
};
