import { z } from "zod";
import { ChatRequest, CreateLessonRequest, LessonPlan, type StepPublic } from "../../shared/api.ts";
import { SETTINGS_LIMITS } from "../../shared/settings.ts";
import { sql } from "../db.ts";
import { HttpError, json, route } from "../http.ts";
import { loadSettings, resolveModel, StoredCitations } from "../learn/core.ts";
import { retrievePapers } from "../lit/openalex.ts";
import { filterCitations, toCitations } from "../lit/core.ts";
import { chatJson, chatStream } from "../llm/gateway.ts";
import { slugOf } from "../topics/core.ts";
import { findMasteredSlugs, listMasteredNames, upsertTopics } from "../topics/sql.ts";
import { gatherSources } from "../sources/collect.ts";
import { MAX_PDF_BYTES, MAX_SOURCE_FILES } from "../sources/core.ts";
import { SourcedPlanOut, StepContent, StepOut, StoredPlan, allCitations, buildChatContext, buildPlanPrompt, buildStepPrompt, buildTutorSystem, categoryOfStep, KNOWN_TOPICS_IN_PROMPT, listPrereqs, maxPlanSteps, normalizePlan, normalizeStep, pickLessonModel, toPublicPlan, toStepPublic, unmetPrereqs } from "./core.ts";
import { deleteLessonData, ensureConversation, findLesson, insertLesson, insertStep, insertMessagePair, listLessons, listMessages, listPapers, listSteps, type LessonRow } from "./sql.ts";

const IdParams = z.strictObject({ id: z.uuid() });
const StepParams = z.strictObject({ id: z.uuid(), idx: z.coerce.number().int().min(0).max(SETTINGS_LIMITS.bite.stepsPerLesson.max - 1) });
const ListQuery = z.strictObject({ limit: z.coerce.number().int().min(1).max(20).default(20) });
const LESSON_JSON_BYTES = 64 * 1024;
const LESSON_FORM_BYTES = MAX_SOURCE_FILES * MAX_PDF_BYTES + LESSON_JSON_BYTES;
const FORM_FIELDS: ReadonlySet<string> = new Set(["prompt", "model"]);
const MessagesQuery = z.strictObject({ before: z.string().regex(/^\d{1,18}$/).optional(), limit: z.coerce.number().int().min(1).max(50).default(50) });

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
  const p = StoredPlan.safeParse(lesson.plan);
  if (!p.success) throw new Error("stored plan is invalid");
  return p.data;
}

function stepOf(r: Awaited<ReturnType<typeof listSteps>>[number]): StepPublic {
  return toStepPublic(r.idx, StepContent.parse(r.content), r.question);
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

// INV: attachments are read before any model call and passed to this one plan call only; the plan keeps at most short per-step notes
const create = route({ entitled: true, raw: true, maxBody: LESSON_FORM_BYTES, rate: { key: "lesson", cap: 10, perMin: 10 } }, async (c) => {
  const uid = c.user.id;
  const input = await readLessonInput(c.req);
  const settings = loadSettings(c.user);
  const model = resolveModel(settings, input.body.model);
  const [papers, known, sources] = await Promise.all([retrievePapers(input.body.prompt, 5), listMasteredNames(uid, KNOWN_TOPICS_IN_PROMPT), gatherSources(input.body.urls ?? [], input.files)]);
  const sourced = sources.count > 0;
  const call = { who: { uid, plan: c.plan, capMicros: c.capMicros }, model, kind: "lesson", system: buildPlanPrompt(settings, papers, known, sourced), user: input.body.prompt + sources.block, files: sources.files };
  const out = sourced ? (await chatJson({ ...call, schema: SourcedPlanOut, maxTokens: 5000 })).data : (await chatJson({ ...call, schema: LessonPlan, maxTokens: 2500 })).data;
  const plan = normalizePlan(out, settings.bite.stepsPerLesson, maxPlanSteps(settings.bite.stepsPerLesson));
  const lessonId = await sql.begin(async (tx) => {
    const ids = await upsertTopics(tx, uid, [plan.topic, ...plan.related], plan.related.map((rel, i) => ({ src: 0, dst: i + 1, kind: rel.kind })));
    const topicId = ids[0];
    if (!topicId) throw new HttpError(502, "llm_bad_output");
    return insertLesson(tx, uid, topicId, plan, papers.map((p) => p.id), model);
  });
  return json({ lessonId, plan: toPublicPlan(plan), grounded: papers.length > 0 });
});

const list = route({ auth: true }, async (c) => {
  const q = ListQuery.safeParse(query(c.req));
  if (!q.success) throw new HttpError(400, "bad_request");
  const rows = await listLessons(c.user.id, q.data.limit);
  return json(rows.map((l) => ({ id: l.id, title: l.title, createdAt: l.created_at.toISOString() })));
});

const get = route({ auth: true }, async (c) => {
  const lesson = await requireLesson(c.user.id, c.params);
  const plan = readPlan(lesson);
  const [papers, steps, mastered] = await Promise.all([listPapers(lesson.paper_ids), listSteps(c.user.id, lesson.id), findMasteredSlugs(c.user.id, listPrereqs(plan).map(slugOf))]);
  return json({ id: lesson.id, title: lesson.title, plan: toPublicPlan(plan), prerequisites: unmetPrereqs(plan, mastered), steps: steps.map(stepOf), citations: allCitations(papers) });
});

const makeStep = route({ entitled: true, rate: { key: "step", cap: 30, perMin: 30 } }, async (c) => {
  const uid = c.user.id;
  const p = StepParams.safeParse({ id: c.params.id, idx: c.params.idx });
  const lesson = p.success ? await findLesson(uid, p.data.id) : null;
  if (!p.success || !lesson) throw new HttpError(404, "not_found");
  const plan = readPlan(lesson);
  const idx = p.data.idx;
  const planned = plan.steps[idx];
  if (!planned) throw new HttpError(404, "not_found");
  const have = (await listSteps(uid, lesson.id, idx))[0];
  if (have) return json(stepOf(have));
  const settings = loadSettings(c.user);
  const papers = await listPapers(lesson.paper_ids);
  const r = await chatJson({
    who: { uid, plan: c.plan, capMicros: c.capMicros },
    model: pickLessonModel(lesson.model, settings),
    kind: "step",
    system: buildStepPrompt(settings, plan, idx, papers),
    user: plan.title,
    schema: StepOut,
    maxTokens: 2000,
  });
  const step = normalizeStep(r.data, planned.title, settings.bite.maxWordsPerStep, papers, categoryOfStep(idx));
  if (!(await insertStep(uid, lesson, idx, step))) throw new HttpError(404, "not_found");
  const row = (await listSteps(uid, lesson.id, idx))[0];
  if (!row) throw new Error("step missing after insert");
  return json(stepOf(row));
});

const chat = route({ entitled: true, body: ChatRequest, rate: { key: "chat", cap: 20, perMin: 20 } }, async (c) => {
  const uid = c.user.id;
  const lesson = await requireLesson(uid, c.params);
  const settings = loadSettings(c.user);
  const papers = await listPapers(lesson.paper_ids);
  const system = buildTutorSystem(settings, readPlan(lesson), papers);
  const model = pickLessonModel(lesson.model, settings);
  const convId = await ensureConversation(uid, lesson.id);
  const recent = await listMessages(uid, lesson.id, null, 12);
  const stream = chatStream({
    who: { uid, plan: c.plan, capMicros: c.capMicros },
    model,
    kind: "chat",
    system,
    messages: buildChatContext([{ role: "user", content: c.body.message }, ...recent.map((m) => ({ role: m.role, content: m.content }))]),
    maxTokens: 900,
    signal: c.req.signal,
    onDone: async (text) => {
      const f = filterCitations(text, papers.length);
      const citations = toCitations(f.used, papers);
      await insertMessagePair(uid, convId, c.body.message, f.text, citations);
      return { citations };
    },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-store" } });
});

const removeLesson = route({ auth: true }, async (c) => {
  const p = IdParams.safeParse({ id: c.params.id });
  if (!p.success || !(await deleteLessonData(c.user.id, p.data.id))) throw new HttpError(404, "not_found");
  return new Response(null, { status: 204 });
});

const messages = route({ auth: true }, async (c) => {
  const lesson = await requireLesson(c.user.id, c.params);
  const q = MessagesQuery.safeParse(query(c.req));
  if (!q.success) throw new HttpError(400, "bad_request");
  const rows = await listMessages(c.user.id, lesson.id, q.data.before ?? null, q.data.limit);
  return json(rows.map((m) => ({ id: m.id, role: m.role, content: m.content, citations: StoredCitations.parse(m.citations), createdAt: m.created_at.toISOString() })));
});

export const teachRoutes = {
  "/api/lessons": { GET: list, POST: create },
  "/api/lessons/:id": { GET: get, DELETE: removeLesson },
  "/api/lessons/:id/steps/:idx": { POST: makeStep },
  "/api/lessons/:id/chat": { POST: chat },
  "/api/lessons/:id/messages": { GET: messages },
};
