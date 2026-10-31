import { InsightsResponse, StatsQuery, type GraphResponse, type StatsResponse } from "../../shared/api.ts";
import { HttpError, json, route } from "../http.ts";
import { chatJson } from "../llm/gateway.ts";
import { loadSettings } from "../learn/core.ts";
import { INSIGHT_SYSTEM, InsightOut, buildInsightPrompt, computeMetrics, normalizeTrends, streakOf, toDayString } from "./core.ts";
import { countDue, findInsight, insertInsight, listDaily, listDomains, listGraph, listTopStats } from "./sql.ts";

const inflight = new Map<string, Promise<InsightsResponse>>();

// O(days + topics), exactly 4 queries
async function loadStats(user: { id: string; settings: Record<string, unknown> }, days: number): Promise<StatsResponse> {
  const [daily, domains, topics, dueNow] = await Promise.all([listDaily(user.id, days), listDomains(user.id), listTopStats(user.id), countDue(user.id)]);
  const today = toDayString(new Date());
  const sum = daily.reduce((a, d) => ({ attempts: a.attempts + d.attempts, correct: a.correct + d.correct, reviews: a.reviews + d.reviews, reviewCorrect: a.reviewCorrect + d.reviewCorrect, confErrSum: a.confErrSum + d.confErrSum }), { attempts: 0, correct: 0, reviews: 0, reviewCorrect: 0, confErrSum: 0 });
  const all = domains.reduce((a, d) => ({ mastered: a.mastered + (d.mastered ?? 0), topics: a.topics + (d.topics ?? 0) }), { mastered: 0, topics: 0 });
  return {
    totals: { ...computeMetrics({ ...sum, ...all }), streakDays: streakOf(daily, today), dueNow, topicsStarted: all.topics, goalToday: { done: daily.find((d) => d.day === today)?.attempts ?? 0, target: loadSettings(user).practice.dailyGoal } },
    daily: daily.map((d) => ({ day: d.day, ...computeMetrics(d) })),
    byDomain: domains.map((d) => ({ domain: d.domain, ...computeMetrics(d) })),
    byTopic: topics.map((t) => ({ id: t.id, name: t.name, domain: t.domain, ...computeMetrics(t) })),
  };
}

const graph = route({ auth: true }, async (c) => {
  const g = await listGraph(c.user.id);
  const body: GraphResponse = g;
  return json(body);
});

// INV: personal stats and insights are a pro feature; the free plan gets 402 pro_required
const stats = route({ auth: true, pro: true }, async (c) => {
  const q = StatsQuery.safeParse(Object.fromEntries(new URL(c.req.url).searchParams));
  if (!q.success) throw new HttpError(400, "bad_request");
  return json(await loadStats(c.user, q.data.days));
});

const insights = route({ entitled: true, pro: true }, async (c) => {
  const uid = c.user.id;
  const day = toDayString(new Date());
  const stored = await findInsight(uid, day);
  if (stored !== null) {
    const cached = InsightsResponse.safeParse({ day, ...(stored as object) });
    if (cached.success) return json(cached.data);
  }
  // INV: ≤1 LLM call per user per day (stored row, plus an in-flight guard in this single process)
  const running = inflight.get(uid);
  if (running) return json(await running);
  const job = (async (): Promise<InsightsResponse> => {
    const s = await loadStats(c.user, 30);
    const r = await chatJson({ who: { uid, plan: c.plan, capMicros: c.capMicros }, model: { system: "insight" }, kind: "insight", system: INSIGHT_SYSTEM, user: buildInsightPrompt(s), schema: InsightOut, maxTokens: 600 });
    const body = { trends: normalizeTrends(r.data) };
    await insertInsight(uid, day, body);
    return { day, ...body };
  })();
  inflight.set(uid, job);
  try {
    return json(await job);
  } finally {
    inflight.delete(uid);
  }
});

export const statsRoutes = {
  "/api/graph": { GET: graph },
  "/api/stats": { GET: stats },
  "/api/insights": { GET: insights },
};
