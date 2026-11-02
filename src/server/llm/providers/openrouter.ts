import { z } from "zod";
import { env } from "../../env.ts";
import { readProviderKey } from "../../secrets.ts";
import { buildOpenAiChatBody, probeBearer, providerHttpDetail, streamOpenAiChat } from "./openaiSse.ts";
import type { ConnectionStatus, LlmEvent, LlmRequest, ModelRef, ProviderAdapter, ReasoningLevel } from "./types.ts";

const REASONING: readonly ReasoningLevel[] = ["low", "high", "max"];
const Item = z.object({
  id: z.string(),
  name: z.string().optional(),
  context_length: z.number().nullish(),
  architecture: z.object({ modality: z.string().optional(), input_modalities: z.array(z.string()).optional() }).optional(),
  supported_parameters: z.array(z.string()).optional(),
});
const Catalog = z.object({ data: z.array(z.unknown()) });

// O(1)
function openRouterBase(): string {
  return env.OPENROUTER_BASE_URL.replace(/\/$/, "");
}

// O(1)
function modelOf(raw: unknown): ModelRef | null {
  const parsed = Item.safeParse(raw);
  if (!parsed.success || parsed.data.id.length === 0) return null;
  const item = parsed.data;
  const modalities = item.architecture?.input_modalities ?? [];
  const modality = item.architecture?.modality ?? "";
  const params = new Set(item.supported_parameters ?? []);
  const vision = modalities.includes("image") || modality.includes("image");
  const structured = params.has("response_format") || params.has("structured_outputs") ? "native" : "prompted";
  const reasoning = params.has("reasoning") || params.has("include_reasoning") ? REASONING : [];
  return { provider: "openrouter", id: item.id, label: item.name && item.name.length > 0 ? item.name : item.id, vision, structured, reasoning, contextTokens: item.context_length ?? 0 };
}

// O(1)
export async function probeOpenRouterKey(key: string, fetchFn: typeof fetch = fetch): Promise<"ok" | "invalid" | "unreachable"> {
  return probeBearer(`${openRouterBase()}/key`, key, fetchFn);
}

// O(1)
export function createOpenRouterAdapter(fetchFn: typeof fetch = fetch): ProviderAdapter {
  return {
    id: "openrouter",
    auth: "api_key",
    async status(): Promise<ConnectionStatus> {
      const key = await readProviderKey("openrouter");
      if (key === null) return { provider: "openrouter", auth: "api_key", connected: false, detail: "key_invalid" };
      const probed = await probeOpenRouterKey(key, fetchFn);
      if (probed === "ok") return { provider: "openrouter", auth: "api_key", connected: true, detail: "ok" };
      return { provider: "openrouter", auth: "api_key", connected: false, detail: probed === "invalid" ? "key_invalid" : "unreachable" };
    },
    async listModels(): Promise<readonly ModelRef[]> {
      const key = await readProviderKey("openrouter");
      if (key === null) throw new Error("openrouter key missing");
      const res = await fetchFn(`${openRouterBase()}/models`, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15_000) });
      if (!res.ok) {
        await res.body?.cancel();
        throw new Error(`openrouter models ${providerHttpDetail(res.status)}`);
      }
      const catalog = Catalog.safeParse(await res.json());
      if (!catalog.success) throw new Error("openrouter models malformed");
      const models = catalog.data.data.map(modelOf).filter((model): model is ModelRef => model !== null);
      if (models.length === 0) throw new Error("openrouter models empty");
      return models;
    },
    stream(req: LlmRequest): AsyncIterable<LlmEvent> {
      return streamOpenRouter(req, fetchFn);
    },
  };
}

// O(n) in the streamed response
async function* streamOpenRouter(req: LlmRequest, fetchFn: typeof fetch): AsyncIterable<LlmEvent> {
  const key = await readProviderKey("openrouter");
  if (key === null) {
    yield { type: "error", code: "not_connected" };
    return;
  }
  const body = buildOpenAiChatBody(req, true, "openrouter");
  yield* streamOpenAiChat(`${openRouterBase()}/chat/completions`, key, body, req.signal, fetchFn, { "HTTP-Referer": "https://github.com/bridgetogrowth", "X-Title": "BridgeToGrowth Learning" });
}

export const openRouterAdapter = createOpenRouterAdapter();
