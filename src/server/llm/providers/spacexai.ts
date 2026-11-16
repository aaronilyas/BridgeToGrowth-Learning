import { z } from "zod";
import { readProviderKey } from "../../secrets.ts";
import { spawnCodexLines, type CodexRun } from "./codexRun.ts";
import { curatedSpaceXaiModels } from "./curated.ts";
import { findGrokBin, onGrokLoginChange } from "./grokLogin.ts";
import { parseGrokModels } from "./grokParse.ts";
import { streamGrokEvents } from "./grokRun.ts";
import { buildOpenAiChatBody, probeBearer, streamOpenAiChat } from "./openaiSse.ts";
import { createStatusCache, STATUS_TTL_MS } from "./statusCache.ts";
import type { ConnectionStatus, LlmEvent, LlmRequest, ModelRef, ProviderAdapter, ReasoningLevel, SubscriptionDetail } from "./types.ts";

const BASE = "https://api.x.ai/v1";
const REASONING: readonly ReasoningLevel[] = ["low", "high", "max"];
const Item = z.object({ id: z.string(), name: z.string().optional() });
const Catalog = z.object({ data: z.array(z.unknown()) });

export type SpaceXaiDeps = {
  fetchFn: typeof fetch;
  which: () => string | null;
  readModels: (bin: string) => Promise<string>;
  readKey: () => Promise<string | null>;
  run: (argv: readonly string[], prompt: string, signal: AbortSignal, cwd: string) => CodexRun;
};

type CliState = { detail: SubscriptionDetail; ids: string[]; at: number };

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

// O(n) in the model ids
function subscriptionModels(ids: readonly string[]): ModelRef[] {
  return ids.map((id) => ({ provider: "spacexai", id, label: `${id.replace(/^grok-/, "Grok ")} (subscription)`, vision: false, structured: "native", reasoning: REASONING, contextTokens: 0 }));
}

// O(1)
async function readGrokModelsText(bin: string): Promise<string> {
  const proc = Bun.spawn([bin, "models"], { stdin: "ignore", stdout: "pipe", stderr: "ignore" });
  const timer = setTimeout(() => proc.kill(), 15_000);
  try {
    const text = await new Response(proc.stdout).text();
    await proc.exited;
    return text;
  } finally {
    clearTimeout(timer);
  }
}

// O(1)
function defaultSpaceXaiDeps(): SpaceXaiDeps {
  return { fetchFn: fetch, which: findGrokBin, readModels: readGrokModelsText, readKey: () => readProviderKey("spacexai"), run: spawnCodexLines };
}

// O(1)
// INV: a grok.com subscription signed in through the official grok CLI wins over a stored API key; the key is the fallback
// INV: status() and stream() share one createStatusCache, and stream() picks the CLI or the key from that status, so a model call that has just checked does not run `grok models` or the key probe again
export function createSpaceXaiAdapter(overrides: Partial<SpaceXaiDeps> = {}): ProviderAdapter {
  const deps: SpaceXaiDeps = { ...defaultSpaceXaiDeps(), ...overrides };
  let cli: CliState | null = null;
  let cliGeneration = 0;
  const status = createStatusCache(async (): Promise<ConnectionStatus> => {
    const state = await readCli();
    if (state.detail === "ok") return { provider: "spacexai", auth: "subscription", connected: true, detail: "ok", subscription: "ok" };
    return keyStatus(state.detail);
  });
  // O(1)
  // INV: a CLI read that started before this call is never kept, so a sign-out cannot be undone by a check already in flight
  function forgetAll(): void {
    cliGeneration += 1;
    cli = null;
    status.forget();
  }
  onGrokLoginChange(forgetAll);

  // INV: only a signed-in CLI state is kept, for STATUS_TTL_MS, so a sign-in done in a terminal shows at once and listModels reuses the ids the status check read
  async function readCli(): Promise<CliState> {
    if (cli !== null && Date.now() - cli.at < STATUS_TTL_MS) return cli;
    cli = null;
    const at = Date.now();
    const started = cliGeneration;
    const bin = deps.which();
    if (bin === null) return { detail: "cli_missing", ids: [], at };
    let state: CliState;
    try {
      const parsed = parseGrokModels(await deps.readModels(bin));
      state = { detail: parsed.loggedIn ? "ok" : "logged_out", ids: parsed.ids, at };
    } catch {
      state = { detail: "logged_out", ids: [], at };
    }
    if (state.detail === "ok" && started === cliGeneration) cli = state;
    return state;
  }

  async function keyStatus(subscription: SubscriptionDetail): Promise<ConnectionStatus> {
    const key = await deps.readKey();
    if (key === null) return { provider: "spacexai", auth: "subscription", connected: false, detail: subscription === "cli_missing" ? "cli_missing" : "logged_out", subscription };
    const probed = await probeSpaceXaiKey(key, deps.fetchFn);
    if (probed === "ok") return { provider: "spacexai", auth: "api_key", connected: true, detail: "ok", subscription };
    return { provider: "spacexai", auth: "api_key", connected: false, detail: probed === "invalid" ? "key_invalid" : "unreachable", subscription };
  }

  async function* streamSpaceXai(req: LlmRequest): AsyncIterable<LlmEvent> {
    const current = await status.read();
    const bin = deps.which();
    if (current.subscription === "ok" && bin !== null) {
      yield* streamGrokEvents(req, bin, deps.run);
      return;
    }
    const key = await deps.readKey();
    if (key === null) {
      yield { type: "error", code: "not_connected" };
      return;
    }
    yield* streamOpenAiChat(`${BASE}/chat/completions`, key, buildOpenAiChatBody(req, false, "xai"), req.signal, deps.fetchFn);
  }

  return {
    id: "spacexai",
    auth: "subscription",
    status: status.read,
    forgetStatus: forgetAll,
    async listModels(): Promise<readonly ModelRef[]> {
      const state = await readCli();
      if (state.detail === "ok") {
        if (state.ids.length === 0) throw new Error("grok models empty");
        return subscriptionModels(state.ids);
      }
      const key = await deps.readKey();
      if (key === null) return curatedSpaceXaiModels();
      try {
        const res = await deps.fetchFn(`${BASE}/models`, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15_000) });
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
      return streamSpaceXai(req);
    },
  };
}

export const spaceXaiAdapter = createSpaceXaiAdapter();
