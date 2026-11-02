import { z } from "zod";
import { readProviderKey } from "../../secrets.ts";
import { curatedSpaceXaiModels } from "./curated.ts";
import { buildOpenAiChatBody, probeBearer, streamOpenAiChat } from "./openaiSse.ts";
import type { ConnectionStatus, LlmEvent, LlmRequest, ModelRef, ProviderAdapter, ReasoningLevel } from "./types.ts";

const BASE = "https://api.x.ai/v1";
const REASONING: readonly ReasoningLevel[] = ["low", "high", "max"];
const Item = z.object({ id: z.string(), name: z.string().optional() });
const Catalog = z.object({ data: z.array(z.unknown()) });

// O(1)
export async function probeSpaceXaiKey(key: string, fetchFn: typeof fetch = fetch): Promise<"ok" | "invalid" | "unreachable"> {
  return probeBearer(`${BASE}/models`, key, fetchFn);
}

// O(n) in the catalog
function modelsFrom(raw: unknown): ModelRef[] {
  const catalog = Catalog.safeParse(raw);
  if (!catalog.success) return [];
  const out: ModelRef[] = [];
  for (const item of catalog.data.data) {
    const parsed = Item.safeParse(item);
    if (!parsed.success || parsed.data.id.length === 0) continue;
    out.push({ provider: "spacexai", id: parsed.data.id, label: parsed.data.name && parsed.data.name.length > 0 ? parsed.data.name : parsed.data.id, vision: true, structured: "native", reasoning: REASONING, contextTokens: 0 });
  }
  return out;
}

// O(1)
export function createSpaceXaiAdapter(fetchFn: typeof fetch = fetch): ProviderAdapter {
  return {
    id: "spacexai",
    auth: "api_key",
    async status(): Promise<ConnectionStatus> {
      const key = await readProviderKey("spacexai");
      if (key === null) return { provider: "spacexai", auth: "api_key", connected: false, detail: "key_invalid" };
      const probed = await probeSpaceXaiKey(key, fetchFn);
      if (probed === "ok") return { provider: "spacexai", auth: "api_key", connected: true, detail: "ok" };
      return { provider: "spacexai", auth: "api_key", connected: false, detail: probed === "invalid" ? "key_invalid" : "unreachable" };
    },
    async listModels(): Promise<readonly ModelRef[]> {
      const key = await readProviderKey("spacexai");
      if (key === null) return curatedSpaceXaiModels();
      try {
        const res = await fetchFn(`${BASE}/models`, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15_000) });
        if (!res.ok) {
          await res.body?.cancel();
          return curatedSpaceXaiModels();
        }
        const models = modelsFrom(await res.json());
        return models.length > 0 ? models : curatedSpaceXaiModels();
      } catch {
        return curatedSpaceXaiModels();
      }
    },
    stream(req: LlmRequest): AsyncIterable<LlmEvent> {
      return streamSpaceXai(req, fetchFn);
    },
  };
}

// O(n) in the streamed response
async function* streamSpaceXai(req: LlmRequest, fetchFn: typeof fetch): AsyncIterable<LlmEvent> {
  const key = await readProviderKey("spacexai");
  if (key === null) {
    yield { type: "error", code: "not_connected" };
    return;
  }
  yield* streamOpenAiChat(`${BASE}/chat/completions`, key, buildOpenAiChatBody(req, false, "xai"), req.signal, fetchFn);
}

export const spaceXaiAdapter = createSpaceXaiAdapter();
