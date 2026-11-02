import { z } from "zod";
import type { LoginState } from "../../../shared/providers.ts";
import { codexEffortValue, spawnCodexLines, streamCodexEvents, type CodexRun } from "./codexRun.ts";
import type { ConnectionStatus, LlmEvent, LlmRequest, ModelRef, ProviderAdapter, ReasoningLevel } from "./types.ts";

const Level = z.object({ effort: z.string() });
const ModelItem = z.object({
  slug: z.string(),
  display_name: z.string(),
  visibility: z.string().optional(),
  context_window: z.number().optional(),
  input_modalities: z.array(z.string()).optional(),
  supported_reasoning_levels: z.array(Level).optional(),
});
const Catalog = z.object({ models: z.array(z.unknown()) });

const efforts = new Map<string, readonly string[]>();
let login: { state: LoginState["state"]; proc: Bun.Subprocess | null } = { state: "idle", proc: null };

export type CodexDeps = {
  which: (name: string) => string | null;
  statusCode: () => Promise<number>;
  run: (argv: readonly string[], prompt: string, signal: AbortSignal, cwd: string) => CodexRun;
};

// O(1)
export function rememberCodexEfforts(id: string, levels: readonly string[]): void {
  efforts.set(id, levels);
}

// O(n) in stored models
export function hydrateCodexEfforts(raw: Record<string, string[]> | undefined): void {
  if (raw === undefined) return;
  for (const [id, levels] of Object.entries(raw)) efforts.set(id, levels);
}

// O(n) in stored models
export function codexEffortSnapshot(): Record<string, string[]> {
  return Object.fromEntries([...efforts].map(([id, levels]) => [id, [...levels]]));
}

// O(1)
function reasoningOf(levels: readonly string[]): ReasoningLevel[] {
  const out: ReasoningLevel[] = [];
  if (levels.includes("low")) out.push("low");
  if (levels.includes("high")) out.push("high");
  if (levels.includes("max")) out.push("max");
  return out;
}

// O(1)
async function readStdout(proc: Bun.Subprocess): Promise<{ code: number; text: string }> {
  const stdout = proc.stdout;
  const text = stdout !== undefined && typeof stdout !== "number" ? await new Response(stdout).text() : "";
  return { code: await proc.exited, text };
}

// O(1)
function defaultDeps(): CodexDeps {
  return {
    which: (name) => Bun.which(name),
    statusCode: async () => {
      const bin = Bun.which("codex");
      if (bin === null) return 127;
      const proc = Bun.spawn([bin, "login", "status"], { stdout: "ignore", stderr: "ignore" });
      return proc.exited;
    },
    run: spawnCodexLines,
  };
}

// O(1)
export function createCodexAdapter(deps: CodexDeps = defaultDeps()): ProviderAdapter {
  return {
    id: "codex",
    auth: "subscription",
    async status(): Promise<ConnectionStatus> {
      const bin = deps.which("codex");
      if (bin === null) return { provider: "codex", auth: "subscription", connected: false, detail: "cli_missing" };
      const code = await deps.statusCode();
      if (code === 0) return { provider: "codex", auth: "subscription", connected: true, detail: "ok" };
      return { provider: "codex", auth: "subscription", connected: false, detail: "logged_out" };
    },
    async listModels(): Promise<readonly ModelRef[]> {
      const bin = deps.which("codex");
      if (bin === null) return [];
      const proc = Bun.spawn([bin, "debug", "models"], { stdout: "pipe", stderr: "ignore" });
      const result = await readStdout(proc);
      if (result.code !== 0) throw new Error("codex models failed");
      const catalog = Catalog.safeParse(JSON.parse(result.text));
      if (!catalog.success) throw new Error("codex models malformed");
      const models: ModelRef[] = [];
      for (const raw of catalog.data.models) {
        const parsed = ModelItem.safeParse(raw);
        if (!parsed.success || parsed.data.visibility !== "list") continue;
        const levels = (parsed.data.supported_reasoning_levels ?? []).map((level) => level.effort);
        rememberCodexEfforts(parsed.data.slug, levels);
        models.push({
          provider: "codex",
          id: parsed.data.slug,
          label: parsed.data.display_name,
          vision: (parsed.data.input_modalities ?? []).includes("image"),
          structured: "native",
          reasoning: reasoningOf(levels),
          contextTokens: parsed.data.context_window ?? 0,
        });
      }
      return models;
    },
    stream(req: LlmRequest): AsyncIterable<LlmEvent> {
      return streamCodex(req, deps);
    },
  };
}

// O(n) in the CLI output
async function* streamCodex(req: LlmRequest, deps: CodexDeps): AsyncIterable<LlmEvent> {
  const current = await createCodexAdapter(deps).status();
  if (!current.connected) {
    yield { type: "error", code: "not_connected" };
    return;
  }
  const bin = deps.which("codex");
  if (bin === null) {
    yield { type: "error", code: "not_connected" };
    return;
  }
  const known = efforts.get(req.model.id) ?? req.model.reasoning;
  yield* streamCodexEvents(req, codexEffortValue(req.reasoning, known), bin, deps.run);
}

// O(1)
// SEC: login is the user's own CLI opening their browser; this process never reads ~/.codex
export function beginCodexLogin(which: (name: string) => string | null = (name) => Bun.which(name)): void {
  if (login.state === "pending") return;
  const bin = which("codex");
  if (bin === null) {
    login = { state: "failed", proc: null };
    return;
  }
  const proc = Bun.spawn([bin, "login"], { stdin: "ignore", stdout: "ignore", stderr: "ignore" });
  login = { state: "pending", proc };
  void proc.exited.then((code) => {
    if (login.proc !== proc) return;
    login = { state: code === 0 ? "ok" : "failed", proc: null };
  });
}

// O(1)
export function readCodexLogin(): LoginState {
  return { state: login.state };
}

export const codexAdapter = createCodexAdapter();
