import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ChatMessage, LlmEvent, LlmRequest, ReasoningLevel } from "./types.ts";
import { parseCodexLine } from "./codexParse.ts";

const DISABLED = ["shell_tool", "unified_exec", "apps", "plugins", "multi_agent", "image_generation", "browser_use", "browser_use_external", "computer_use", "hooks", "sleep_tool", "view_image", "tool_suggest", "skill_search", "goals", "in_app_browser", "remote_plugin"];

export type CodexRun = { lines: AsyncIterable<string>; stop: () => void };

// O(1)
export function codexEffortValue(requested: ReasoningLevel, known: readonly string[]): string {
  if (requested === "low") return known.includes("low") ? "low" : "low";
  if (requested === "high") return known.includes("high") ? "high" : "high";
  if (known.includes("max")) return "max";
  if (known.includes("xhigh")) return "xhigh";
  if (known.includes("high")) return "high";
  return "high";
}

// O(n) in flags
// SEC: read-only sandbox, no user config, no rules, and every known tool feature except code_mode_host is disabled
export function codexExecArgv(bin: string, req: LlmRequest, cwd: string, effort: string, schemaPath: string | null, images: readonly string[]): string[] {
  const args = [bin, "exec", "--json", "--ephemeral", "--skip-git-repo-check", "--ignore-user-config", "--ignore-rules", "-s", "read-only", "-c", 'approval_policy="never"', "-c", 'web_search="disabled"'];
  for (const feature of DISABLED) args.push("--disable", feature);
  args.push("-m", req.model.id, "-c", `model_reasoning_effort="${effort}"`);
  if (schemaPath !== null) args.push("--output-schema", schemaPath);
  for (const image of images) args.push("-i", image);
  args.push("-C", cwd, "-");
  return args;
}

// O(n) in the transcript
// INV: Codex has no system flag, so the server system text is delimited ahead of the transcript
export function renderCodexPrompt(system: string, messages: readonly ChatMessage[]): string {
  const lines = ["<system>", system, "</system>", ""];
  for (const message of messages) lines.push(`<${message.role}>`, message.text, `</${message.role}>`, "");
  return lines.join("\n");
}

// O(n) in image bytes
function writeImages(cwd: string, messages: readonly ChatMessage[]): string[] {
  const paths: string[] = [];
  let n = 0;
  for (const message of messages) {
    for (const image of message.images ?? []) {
      if (!image.mime.startsWith("image/")) continue;
      const marker = image.dataUrl.indexOf(",");
      if (!image.dataUrl.startsWith("data:") || marker < 0) continue;
      const bytes = Buffer.from(image.dataUrl.slice(marker + 1), "base64");
      const ext = image.mime === "image/png" ? "png" : image.mime === "image/jpeg" ? "jpg" : "img";
      const path = join(cwd, `image-${n}.${ext}`);
      writeFileSync(path, bytes);
      paths.push(path);
      n += 1;
    }
  }
  return paths;
}

// O(1)
function killProc(proc: Bun.Subprocess): void {
  try {
    proc.kill("SIGTERM");
  } catch {
    return;
  }
  const timer = setTimeout(() => {
    try {
      proc.kill("SIGKILL");
    } catch {
      /* already exited */
    }
  }, 500);
  timer.unref();
  void proc.exited.then(() => clearTimeout(timer));
}

// O(n) in stdout
export function spawnCodexLines(argv: readonly string[], prompt: string, signal: AbortSignal, cwd: string): CodexRun {
  const bin = argv[0];
  if (bin === undefined) return { lines: (async function* () {})(), stop: () => undefined };
  const proc = Bun.spawn([...argv], { cwd, stdin: "pipe", stdout: "pipe", stderr: "ignore" });
  const stop = (): void => killProc(proc);
  if (signal.aborted) stop();
  else signal.addEventListener("abort", stop, { once: true });
  proc.stdin.write(prompt);
  void proc.stdin.end();
  const lines = (async function* () {
    const reader = proc.stdout.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    try {
      while (!signal.aborted) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buf += decoder.decode(chunk.value, { stream: true });
        let nl = buf.indexOf("\n");
        while (nl >= 0) {
          yield buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          nl = buf.indexOf("\n");
        }
      }
      if (buf.trim().length > 0) yield buf;
    } finally {
      signal.removeEventListener("abort", stop);
      reader.releaseLock();
    }
  })();
  return { lines, stop };
}

// O(n) in the CLI output
// SEC: the working directory is an empty temp dir and is removed even when the call throws or aborts
export async function* streamCodexEvents(req: LlmRequest, effort: string, bin: string, run: (argv: readonly string[], prompt: string, signal: AbortSignal, cwd: string) => CodexRun): AsyncIterable<LlmEvent> {
  const cwd = mkdtempSync(join(tmpdir(), "btg-codex-"));
  let stop = (): void => undefined;
  try {
    const images = writeImages(cwd, req.messages);
    let schemaPath: string | null = null;
    if (req.jsonSchema) {
      schemaPath = join(cwd, "schema.json");
      writeFileSync(schemaPath, JSON.stringify(req.jsonSchema));
    }
    const argv = codexExecArgv(bin, req, cwd, effort, schemaPath, images);
    const started = run(argv, renderCodexPrompt(req.system, req.messages), req.signal, cwd);
    stop = started.stop;
    for await (const line of started.lines) {
      const parsed = parseCodexLine(line);
      if (parsed.toolType !== null) console.error(`codex: tool item ${parsed.toolType}`);
      if (parsed.ignoreType !== null) console.error(`codex: item ${parsed.ignoreType}`);
      if (parsed.abort) {
        stop();
        yield* parsed.events;
        return;
      }
      yield* parsed.events;
      // INV: the CLI reports one failure as both `error` and `turn.failed`; the stream ends at the first
      if (parsed.events.some((e) => e.type === "error")) {
        stop();
        return;
      }
    }
    if (req.signal.aborted) {
      const reason: unknown = req.signal.reason;
      if (reason instanceof DOMException && reason.name === "TimeoutError") yield { type: "error", code: "timeout" };
      return;
    }
    yield { type: "done" };
  } finally {
    stop();
    rmSync(cwd, { recursive: true, force: true });
  }
}
