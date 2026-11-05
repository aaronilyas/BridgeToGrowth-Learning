import { z } from "zod";
import type { UsageModel, UsageResponse } from "../../shared/providers.ts";
import { ConnectionStatus, LoginBody, OpenExternalBody, ProviderId, ProviderKeyBody } from "../../shared/providers.ts";
import { fixedExternalUrl, openExternalUrl } from "../external.ts";
import { HttpError, json, route } from "../http.ts";
import { deleteProviderKey, keyHint, readProviderKey, storeProviderKey } from "../secrets.ts";
import { beginCodexLogin, cancelCodexLogin, pendingCodexLoginUrl, readCodexLogin, signOutCodex } from "./providers/codexLogin.ts";
import { beginGrokLogin, cancelGrokLogin, pendingGrokLoginUrl, readGrokLogin, signOutGrok } from "./providers/grokLogin.ts";
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

type LoginProvider = "codex" | "spacexai";

// O(1)
function loginProviderOf(params: Record<string, string>): LoginProvider {
  const id = IdParams.safeParse(params);
  if (!id.success || id.data.id === "openrouter") throw new HttpError(404, "not_found");
  return id.data.id;
}

// O(1)
async function subscriptionConnected(id: LoginProvider): Promise<boolean> {
  const status = await providerAdapter(id).status();
  return id === "codex" ? status.connected : status.subscription === "ok";
}

// INV: a new login is refused while the subscription is signed in, because the CLI may discard the saved session as soon as a login starts
const startLogin = route({ body: LoginBody, rate: { key: "cli-login", cap: 5, perMin: 5 } }, async (c) => {
  const id = loginProviderOf(c.params);
  if (await subscriptionConnected(id)) throw new HttpError(409, "bad_request");
  if (id === "codex") beginCodexLogin(c.body.method);
  else beginGrokLogin(c.body.method);
  await forgetProviderModels(id);
  return json(id === "codex" ? readCodexLogin() : readGrokLogin());
});

const pollLogin = route({}, async (c) => {
  const id = loginProviderOf(c.params);
  const state = id === "codex" ? readCodexLogin() : readGrokLogin();
  if (state.state === "ok") await forgetProviderModels(id);
  return json(state);
});

const cancelLogin = route({}, async (c) => {
  const id = loginProviderOf(c.params);
  if (id === "codex") cancelCodexLogin();
  else cancelGrokLogin();
  return new Response(null, { status: 204 });
});

const logout = route({}, async (c) => {
  const id = loginProviderOf(c.params);
  const ok = id === "codex" ? await signOutCodex() : await signOutGrok();
  if (!ok) throw new HttpError(502, "provider_error");
  await forgetProviderModels(id);
  return new Response(null, { status: 204 });
});

// O(1)
function externalUrlOf(target: z.infer<typeof OpenExternalBody>["target"]): string | null {
  if (target === "codex_signin") return pendingCodexLoginUrl();
  if (target === "spacexai_signin") return pendingGrokLoginUrl();
  return fixedExternalUrl(target);
}

// SEC: the renderer names a target, never a URL; a sign-in target opens only the link the official CLI printed for the pending login
const openExternal = route({ body: OpenExternalBody, rate: { key: "open-external", cap: 10, perMin: 10 } }, async (c) => {
  const url = externalUrlOf(c.body.target);
  if (url === null) throw new HttpError(404, "not_found");
  if (!openExternalUrl(url)) throw new HttpError(502, "provider_error");
  return new Response(null, { status: 204 });
});

export const llmRoutes = {
  "/api/models": { GET: models },
  "/api/usage": { GET: usage },
  "/api/providers": { GET: providers },
  "/api/providers/:id/key": { PUT: putKey, DELETE: deleteKey },
  "/api/providers/:id/login": { POST: startLogin, GET: pollLogin, DELETE: cancelLogin },
  "/api/providers/:id/logout": { POST: logout },
  "/api/open-external": { POST: openExternal },
};
