import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { appDataDir } from "../../paths.ts";
import { AcpError, openAcpConnection, refuseAcpRequest, spawnAcpAgent, type AcpConnection, type AcpReply, type AcpTransport } from "./acp.ts";
import { claudeEffortValue, claudeInitializeParams, claudeModelsFrom, claudePromptBlocks, claudeSessionParams, claudeStopReason, claudeSystemText, claudeUsageEvent, interpretClaudeUpdate, mapClaudeAcpError } from "./claudeAcp.ts";
import { findCliBin } from "./codexLogin.ts";
import { curatedClaudeModels } from "./curated.ts";
import type { ConnectionStatus, LlmEvent, LlmRequest, ModelRef, ProviderAdapter } from "./types.ts";

const STATUS_TTL_MS = 30_000;
const STATUS_TIMEOUT_MS = 10_000;
const MODELS_TIMEOUT_MS = 30_000;
// Variables a parent Claude Code session sets for its own children. A desktop app started from a Claude Code terminal must not pass them on, or the CLI would treat each call as a child of that session.
const SESSION_ENV = /^(CLAUDECODE|CLAUDE_CODE_(ENTRYPOINT|SESSION_ID|CHILD_SESSION|SESSION_ATTENDED|MESSAGING_SOCKET|MESSAGING_TOKEN|EXECPATH)|CLAUDE_PID|CLAUDE_EFFORT|CLAUDE_AGENT_SDK_VERSION)$/;

export type ClaudeDeps = {
  which: () => string | null;
  readStatus: (bin: string) => Promise<{ code: number; text: string }>;
  workDir: () => string;
  connect: (bin: string, cwd: string) => AcpTransport;
};

type StatusCache = { detail: ConnectionStatus["detail"]; at: number };
type Item = { event: LlmEvent; last: boolean };

// O(d) in searched directories
export function findClaudeBin(): string | null {
  return findCliBin("claude");
}

// O(n) in the output
// INV: `claude auth status` prints JSON and exits 0 only while signed in; anything else counts as signed out
export function parseClaudeAuthStatus(code: number, text: string): boolean {
  if (code !== 0) return false;
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed !== null && typeof parsed === "object" && (parsed as Record<string, unknown>).loggedIn === true;
  } catch {
    return false;
  }
}

// O(n) in the environment
export function claudeAgentEnv(base: Record<string, string | undefined>, bin: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(base)) if (value !== undefined && !SESSION_ENV.test(key)) env[key] = value;
  env.CLAUDE_CODE_EXECUTABLE = bin;
  return env;
}

// O(1)
// INV: the packaged app runs the bundled adapter (dist/claude-acp.js) beside the server bundle; a source checkout runs the entry module
function agentScript(): string | null {
  for (const name of ["claude-acp.js", "claudeAcpEntry.ts"]) {
    const path = join(import.meta.dir, name);
    if (existsSync(path)) return path;
  }
  return null;
}

// O(1)
// INV: one fixed, empty folder serves every call, so Claude Code keeps a single project entry for the app rather than one per call
function claudeWorkDir(): string {
  const dir = join(appDataDir(), "claude-acp");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

// O(1)
async function readClaudeStatus(bin: string): Promise<{ code: number; text: string }> {
  const proc = Bun.spawn([bin, "auth", "status", "--json"], { env: claudeAgentEnv(process.env, bin), stdin: "ignore", stdout: "pipe", stderr: "ignore" });
  const timer = setTimeout(() => proc.kill(), STATUS_TIMEOUT_MS);
  try {
    const text = await new Response(proc.stdout).text();
    return { code: await proc.exited, text };
  } finally {
    clearTimeout(timer);
  }
}

// O(1)
// SEC: the adapter runs on the app's own Bun with an argv that never carries user text; the user's Claude Code CLI does the model calls under its own sign-in
function connectClaudeAgent(bin: string, cwd: string): AcpTransport {
  const script = agentScript();
  if (script === null) throw new Error("claude-acp bundle missing");
  return spawnAcpAgent([process.execPath, script], claudeAgentEnv(process.env, bin), cwd);
}

// O(1)
function defaultClaudeDeps(): ClaudeDeps {
  return { which: findClaudeBin, readStatus: readClaudeStatus, workDir: claudeWorkDir, connect: connectClaudeAgent };
}

// O(1)
// SEC: only the JSON-RPC code and the adapter's error kind are logged; the message can quote the prompt or the CLI's stderr
function errorCodeOf(cause: unknown): LlmEvent {
  if (!(cause instanceof AcpError)) {
    console.error("claude: agent call failed");
    return { type: "error", code: "provider_error" };
  }
  const kind = cause.data !== null && typeof cause.data === "object" ? (cause.data as Record<string, unknown>).errorKind : undefined;
  console.error(`claude: agent error ${cause.code}${typeof kind === "string" ? ` (${kind.slice(0, 40)})` : ""}`);
  return { type: "error", code: mapClaudeAcpError(cause.code, cause.message, cause.data) };
}

// O(1)
// SEC: permission prompts and file or terminal requests are refused, and any of them aborts the turn
function refusingHandlers(onUpdate: (update: unknown) => void, onRefused: (method: string) => void): { notification: (method: string, params: unknown) => void; request: (method: string, params: unknown) => AcpReply } {
  return {
    notification(method, params) {
      if (method !== "session/update" || params === null || typeof params !== "object") return;
      onUpdate((params as Record<string, unknown>).update);
    },
    request(method) {
      onRefused(method);
      if (method === "session/request_permission") return { result: { outcome: { outcome: "cancelled" } } };
      return refuseAcpRequest();
    },
  };
}

// O(1)
async function openSession(conn: AcpConnection, params: Record<string, unknown>): Promise<{ sessionId: string; result: unknown }> {
  await conn.request("initialize", claudeInitializeParams());
  const result = await conn.request("session/new", params);
  const sessionId = result !== null && typeof result === "object" ? (result as Record<string, unknown>).sessionId : undefined;
  if (typeof sessionId !== "string") throw new AcpError(-32603, "no session id", undefined);
  return { sessionId, result };
}

// O(n) in the agent's output
// INV: events are queued as notifications arrive and the generator drains the queue, so a slow consumer never drops a chunk
async function* streamClaudeAcp(req: LlmRequest, bin: string, deps: ClaudeDeps): AsyncIterable<LlmEvent> {
  const structured = req.jsonSchema !== undefined;
  const queue: Item[] = [];
  let wake: (() => void) | null = null;
  let ended = false;
  let answer: Record<string, unknown> | null = null;
  const push = (event: LlmEvent, last = false): void => {
    if (ended) return;
    if (last) ended = true;
    queue.push({ event, last });
    wake?.();
  };
  const abortTurn = (what: string): void => {
    if (ended) return;
    console.error(`claude: aborted on ${what}`);
    push({ type: "error", code: "provider_error" }, true);
  };
  const cwd = deps.workDir();
  const conn = openAcpConnection(deps.connect(bin, cwd), refusingHandlers((update) => {
    const read = interpretClaudeUpdate(update, structured);
    if (read.abort !== null) abortTurn(read.abort);
    else if (read.text !== null) push({ type: "text", delta: read.text });
    else if (read.structured !== null) answer = read.structured;
  }, abortTurn));
  let sessionId: string | null = null;
  const onAbort = (): void => {
    if (sessionId !== null) conn.notify("session/cancel", { sessionId });
    const reason: unknown = req.signal.reason;
    if (reason instanceof DOMException && reason.name === "TimeoutError") push({ type: "error", code: "timeout" }, true);
    else push({ type: "done" }, true);
  };
  if (req.signal.aborted) onAbort();
  else req.signal.addEventListener("abort", onAbort, { once: true });
  void (async () => {
    try {
      const session = await openSession(conn, claudeSessionParams(cwd, claudeSystemText(req), { model: req.model.id, effort: claudeEffortValue(req.reasoning), ...(structured && req.jsonSchema !== undefined ? { jsonSchema: req.jsonSchema } : {}) }));
      sessionId = session.sessionId;
      const result = await conn.request("session/prompt", { sessionId, prompt: claudePromptBlocks(req.messages) });
      if (structured && answer !== null) push({ type: "text", delta: JSON.stringify(answer) });
      const usage = claudeUsageEvent(result);
      if (usage !== null) push(usage);
      if (claudeStopReason(result) === "refusal") push({ type: "error", code: "provider_error" }, true);
      else if (structured && answer === null) push({ type: "error", code: "bad_output" }, true);
      else push({ type: "done" }, true);
    } catch (cause) {
      push(errorCodeOf(cause), true);
    }
  })();
  try {
    while (true) {
      const item = queue.shift();
      if (item === undefined) {
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
        wake = null;
        continue;
      }
      if (item.event.type === "done" && req.signal.aborted) return;
      yield item.event;
      if (item.last) return;
    }
  } finally {
    req.signal.removeEventListener("abort", onAbort);
    conn.close();
  }
}

// O(1)
// SEC: this app never signs in or out of Claude Code; it only uses a session the user already has in their own CLI
export function createClaudeAdapter(overrides: Partial<ClaudeDeps> = {}): ProviderAdapter {
  const deps: ClaudeDeps = { ...defaultClaudeDeps(), ...overrides };
  let cache: StatusCache | null = null;

  // INV: only a signed-in result is cached; while signed out every check asks the CLI again, so a sign-in done in a terminal shows up at once
  async function readDetail(): Promise<StatusCache["detail"]> {
    if (cache !== null && cache.detail === "ok" && Date.now() - cache.at < STATUS_TTL_MS) return cache.detail;
    const bin = deps.which();
    let detail: StatusCache["detail"] = "cli_missing";
    if (bin !== null) {
      try {
        const out = await deps.readStatus(bin);
        detail = parseClaudeAuthStatus(out.code, out.text) ? "ok" : "logged_out";
      } catch {
        detail = "logged_out";
      }
    }
    cache = { detail, at: Date.now() };
    return detail;
  }

  return {
    id: "claude",
    auth: "subscription",
    async status(): Promise<ConnectionStatus> {
      const detail = await readDetail();
      return { provider: "claude", auth: "subscription", connected: detail === "ok", detail };
    },
    async listModels(): Promise<readonly ModelRef[]> {
      const bin = deps.which();
      if (bin === null) return [];
      const cwd = deps.workDir();
      const conn = openAcpConnection(deps.connect(bin, cwd), refusingHandlers(() => undefined, () => undefined));
      const timer = setTimeout(() => conn.close(), MODELS_TIMEOUT_MS);
      try {
        const models = claudeModelsFrom((await openSession(conn, claudeSessionParams(cwd, null, null))).result);
        return models.length > 0 ? models : curatedClaudeModels();
      } finally {
        clearTimeout(timer);
        conn.close();
      }
    },
    async *stream(req: LlmRequest): AsyncIterable<LlmEvent> {
      const bin = deps.which();
      if (bin === null || (await readDetail()) !== "ok") {
        yield { type: "error", code: "not_connected" };
        return;
      }
      yield* streamClaudeAcp(req, bin, deps);
    },
  };
}

export const claudeAdapter = createClaudeAdapter();
