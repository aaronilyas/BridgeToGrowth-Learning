import { z } from "zod";
import { ModelRef as ModelRefSchema, type ProviderId } from "../../../shared/providers.ts";
import { sql } from "../../db.ts";
import { HttpError } from "../../http.ts";
import { jsonText, jsonValue } from "../../sqlmap.ts";
import { claudeAdapter } from "./claude.ts";
import { codexAdapter, codexEffortSnapshot, hydrateCodexEfforts } from "./codex.ts";
import { curatedClaudeModels, curatedOpenRouterModels, curatedSpaceXaiModels } from "./curated.ts";
import { openRouterAdapter } from "./openrouter.ts";
import { spaceXaiAdapter } from "./spacexai.ts";
import type { ModelRef, ProviderAdapter } from "./types.ts";

const DAY_MS = 86_400_000;
const CachePayload = z.strictObject({ models: z.array(ModelRefSchema), efforts: z.record(z.string(), z.array(z.string())).optional() });

const adapters: Record<ProviderId, ProviderAdapter> = { openrouter: openRouterAdapter, codex: codexAdapter, spacexai: spaceXaiAdapter, claude: claudeAdapter };

// O(1)
export function installProviderForTest(id: ProviderId, adapter: ProviderAdapter): () => void {
  const previous = adapters[id];
  adapters[id] = adapter;
  return () => {
    adapters[id] = previous;
  };
}

// O(1)
export function providerAdapter(id: ProviderId): ProviderAdapter {
  return adapters[id];
}

// O(1)
export async function connectedProviderIds(): Promise<Set<ProviderId>> {
  const ids = new Set<ProviderId>();
  for (const adapter of Object.values(adapters)) {
    if ((await adapter.status()).connected) ids.add(adapter.id);
  }
  return ids;
}

// O(1)
export async function forgetProviderModels(provider: ProviderId): Promise<void> {
  await sql`DELETE FROM provider_models WHERE provider = ${provider}`;
}

// O(1)
async function readModelCache(provider: ProviderId): Promise<{ models: ModelRef[]; efforts?: Record<string, string[]>; fetchedAt: number } | null> {
  const rows: { payload: unknown; fetched_at: number }[] = await sql`SELECT payload, fetched_at FROM provider_models WHERE provider = ${provider} LIMIT 1`;
  const row = rows[0];
  if (row === undefined) return null;
  const parsed = CachePayload.safeParse(jsonValue(row.payload));
  if (!parsed.success) return null;
  if (parsed.data.efforts === undefined) return { models: parsed.data.models, fetchedAt: row.fetched_at };
  return { models: parsed.data.models, efforts: parsed.data.efforts, fetchedAt: row.fetched_at };
}

// O(n) in the model list
async function writeModelCache(provider: ProviderId, models: readonly ModelRef[], efforts: Record<string, string[]> | undefined): Promise<void> {
  const payload = efforts === undefined ? { models } : { models, efforts };
  const text = jsonText(payload);
  const fetched = Date.now();
  await sql`
    INSERT INTO provider_models (provider, payload, fetched_at) VALUES (${provider}, ${text}, ${fetched})
    ON CONFLICT (provider) DO UPDATE SET payload = excluded.payload, fetched_at = excluded.fetched_at`;
}

// O(n) in the provider catalog
async function loadModels(adapter: ProviderAdapter): Promise<readonly ModelRef[]> {
  const cached = await readModelCache(adapter.id);
  if (cached !== null && Date.now() - cached.fetchedAt < DAY_MS) {
    if (adapter.id === "codex") hydrateCodexEfforts(cached.efforts);
    return cached.models;
  }
  try {
    const models = await adapter.listModels();
    if (models === curatedOpenRouterModels() || models === curatedSpaceXaiModels() || models === curatedClaudeModels()) return models;
    const efforts = adapter.id === "codex" ? codexEffortSnapshot() : undefined;
    await writeModelCache(adapter.id, models, efforts);
    return models;
  } catch {
    if (adapter.id === "openrouter") return curatedOpenRouterModels();
    if (adapter.id === "spacexai") return curatedSpaceXaiModels();
    if (adapter.id === "claude") return curatedClaudeModels();
    return [];
  }
}

// O(n) in connected catalogs
export async function listConnectedModels(): Promise<ModelRef[]> {
  const out: ModelRef[] = [];
  for (const adapter of Object.values(adapters)) {
    if (!(await adapter.status()).connected) continue;
    out.push(...(await loadModels(adapter)));
  }
  return out;
}

// O(n) in connected catalogs
// INV: order is the configured task model, then each candidate id in order, then the first connected model
// INV: an unset task model, or one whose provider has since disconnected, never blocks another connected provider; not_connected only when none is connected
// INV: a configured model that its connected provider no longer lists still fails with model_unavailable rather than being swapped silently
export async function resolveTaskModel(configured: { provider: ProviderId; id: string } | null, candidates: readonly (string | null | undefined)[]): Promise<ModelRef> {
  if (configured !== null && (await adapters[configured.provider].status()).connected) return resolveModelRef(configured);
  const available = await listConnectedModels();
  if (available.length === 0) throw (await connectedProviderIds()).size > 0 ? new HttpError(404, "model_unavailable") : new HttpError(409, "not_connected");
  for (const id of candidates) {
    if (id === null || id === undefined || id.length === 0) continue;
    const found = available.find((model) => model.id === id);
    if (found !== undefined) return found;
  }
  return available[0] as ModelRef;
}

// O(n) in that provider's catalog
// INV: a disconnected provider fails with not_connected before a model id is accepted
export async function resolveModelRef(choice: { provider: ProviderId; id: string }): Promise<ModelRef> {
  const adapter = adapters[choice.provider];
  if (!(await adapter.status()).connected) throw new HttpError(409, "not_connected");
  const found = (await loadModels(adapter)).find((model) => model.id === choice.id);
  if (found === undefined) throw new HttpError(404, "model_unavailable");
  return found;
}
