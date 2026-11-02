import { z } from "zod";
import type { UsageModel, UsageResponse } from "../../shared/providers.ts";
import { ConnectionStatus, LoginState, ProviderId, ProviderKeyBody } from "../../shared/providers.ts";
import { HttpError, json, route } from "../http.ts";
import { deleteProviderKey, keyHint, readProviderKey, storeProviderKey } from "../secrets.ts";
import { beginCodexLogin, readCodexLogin } from "./providers/codex.ts";
import { probeOpenRouterKey } from "./providers/openrouter.ts";
import { forgetProviderModels, listConnectedModels, providerAdapter } from "./providers/registry.ts";
import { probeSpaceXaiKey } from "./providers/spacexai.ts";
import { listUsageGroups } from "./sql.ts";

const IdParams = z.strictObject({ id: ProviderId });

// O(1)
function monthLabel(now: Date): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

// O(1)
function providerOf(id: string): z.infer<typeof ProviderId> | null {
  const parsed = ProviderId.safeParse(id);
  return parsed.success ? parsed.data : null;
}

const models = route({}, async () => json(await listConnectedModels()));

const usage = route({}, async () => {
  const now = new Date();
  const since = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1);
  const groups = await listUsageGroups(since);
  const byPeriod = new Map<string, UsageModel[]>();
  for (const group of groups) {
    const provider = providerOf(group.provider);
    if (provider === null) continue;
    const row: UsageModel = { provider, model: group.model, inputTokens: group.inputTokens, outputTokens: group.outputTokens, costUsd: group.costMicros === null ? null : Number(group.costMicros) / 1e6 };
    const list = byPeriod.get(group.period) ?? [];
    list.push(row);
    byPeriod.set(group.period, list);
  }
  const month = monthLabel(now);
  const body: UsageResponse = { month, current: byPeriod.get(month) ?? [], recent: [...byPeriod.entries()].filter(([period]) => period !== month).map(([period, rows]) => ({ period, models: rows })) };
  return json(body);
});

const providers = route({}, async () => {
  const body: z.infer<typeof ConnectionStatus>[] = [];
  for (const id of ProviderId.options) {
    const status = await providerAdapter(id).status();
    const hint = keyHint(await readProviderKey(id));
    body.push(hint === null ? status : { ...status, last4: hint });
  }
  return json(body);
});

const putKey = route({ body: ProviderKeyBody }, async (c) => {
  const id = IdParams.safeParse(c.params);
  if (!id.success) throw new HttpError(404, "not_found");
  if (id.data.id === "codex") throw new HttpError(400, "bad_request");
  const probe = id.data.id === "openrouter" ? await probeOpenRouterKey(c.body.key) : await probeSpaceXaiKey(c.body.key);
  if (probe === "invalid") throw new HttpError(422, "bad_request");
  if (probe === "unreachable") throw new HttpError(502, "upstream");
  await storeProviderKey(id.data.id, c.body.key);
  await forgetProviderModels(id.data.id);
  const status = await providerAdapter(id.data.id).status();
  const hint = keyHint(c.body.key);
  const body: z.infer<typeof ConnectionStatus> = hint === null ? status : { ...status, last4: hint };
  return json(body);
});

const deleteKey = route({}, async (c) => {
  const id = IdParams.safeParse(c.params);
  if (!id.success || id.data.id === "codex") throw new HttpError(404, "not_found");
  await deleteProviderKey(id.data.id);
  await forgetProviderModels(id.data.id);
  return new Response(null, { status: 204 });
});

const startLogin = route({}, async (c) => {
  const id = IdParams.safeParse(c.params);
  if (!id.success || id.data.id !== "codex") throw new HttpError(404, "not_found");
  beginCodexLogin();
  const body: LoginState = readCodexLogin();
  return json(body);
});

const pollLogin = route({}, async (c) => {
  const id = IdParams.safeParse(c.params);
  if (!id.success || id.data.id !== "codex") throw new HttpError(404, "not_found");
  return json(readCodexLogin());
});

export const llmRoutes = {
  "/api/models": { GET: models },
  "/api/usage": { GET: usage },
  "/api/providers": { GET: providers },
  "/api/providers/:id/key": { PUT: putKey, DELETE: deleteKey },
  "/api/providers/:id/login": { POST: startLogin, GET: pollLogin },
};
