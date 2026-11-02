import type { ModelsResponse, UsageResponse } from "../../shared/api.ts";
import { json, route } from "../http.ts";
import { LOCAL_USER_ID } from "../profile.ts";
import { listModels, periodOf } from "./core.ts";
import { isModelListed } from "./models.ts";
import { findUsage, listCostByModel, listRecentCalls } from "./sql.ts";

const models = route({}, async () => {
  const body: ModelsResponse = listModels()
    .filter((m) => isModelListed(m.id))
    .map((m) => ({ id: m.id, label: m.label }));
  return json(body);
});

const usage = route({}, async () => {
  const period = periodOf(new Date());
  const [row, byModel, recent] = await Promise.all([findUsage(LOCAL_USER_ID, period), listCostByModel(LOCAL_USER_ID, period), listRecentCalls(LOCAL_USER_ID)]);
  const body: UsageResponse = {
    period,
    usedMicros: Number(row.usedMicros),
    reservedMicros: Number(row.reservedMicros),
    byModel: byModel.map((m) => ({ model: m.model, costMicros: Number(m.costMicros) })),
    recent: recent.map((r) => ({ kind: r.kind, model: r.model, promptTokens: r.promptTokens, completionTokens: r.completionTokens, costMicros: Number(r.costMicros), createdAt: r.createdAt.toISOString() })),
  };
  return json(body);
});

export const llmRoutes = {
  "/api/models": { GET: models },
  "/api/usage": { GET: usage },
};
