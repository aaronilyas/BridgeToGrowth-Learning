import type { ModelsResponse, UsageResponse } from "../../shared/api.ts";
import { json, route } from "../http.ts";
import { listModelsForPlan, periodOf } from "./core.ts";
import { isModelListed } from "./models.ts";
import { findUsage, listCostByModel, listRecentCalls } from "./sql.ts";

const models = route({ auth: true }, async (c) => {
  const body: ModelsResponse = listModelsForPlan(c.plan)
    .filter((m) => isModelListed(m.id))
    .map((m) => ({ id: m.id, label: m.label, tier: m.tier }));
  return json(body);
});

// INV: both plans see their usage; the cap is the plan's monthly dollar limit
const usage = route({ auth: true }, async (c) => {
  const period = periodOf(new Date());
  const [row, byModel, recent] = await Promise.all([findUsage(c.user.id, period), listCostByModel(c.user.id, period), listRecentCalls(c.user.id)]);
  const body: UsageResponse = {
    plan: c.plan,
    period,
    usedMicros: Number(row.usedMicros),
    reservedMicros: Number(row.reservedMicros),
    capMicros: Number(c.capMicros),
    byModel: byModel.map((m) => ({ model: m.model, costMicros: Number(m.costMicros) })),
    recent: recent.map((r) => ({ kind: r.kind, model: r.model, promptTokens: r.promptTokens, completionTokens: r.completionTokens, costMicros: Number(r.costMicros), createdAt: r.createdAt.toISOString() })),
  };
  return json(body);
});

export const llmRoutes = {
  "/api/models": { GET: models },
  "/api/usage": { GET: usage },
};
