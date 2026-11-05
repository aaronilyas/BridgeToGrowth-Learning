import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderCodexPrompt, type CodexRun } from "./codexRun.ts";
import { parseGrokLine } from "./grokParse.ts";
import type { LlmEvent, LlmRequest, ReasoningLevel } from "./types.ts";

const DENIED_TOOLS = [
  "run_terminal_command", "read_file", "search_replace", "list_dir", "grep", "kill_command_or_subagent", "todo_write", "get_command_or_subagent_output",
  "scheduler_create", "scheduler_delete", "scheduler_list", "monitor", "search_tool", "use_tool", "workflow", "enter_plan_mode", "exit_plan_mode",
  "ask_user_question", "send_feedback", "image_gen", "image_edit", "image_to_video", "reference_to_video", "write", "web_search", "web_fetch",
];
const GROK_SYSTEM = "You are the answer engine of a tutoring app. You have no tools and must never try to use any. Follow the instructions inside the <system> block of the message exactly.";

// O(1)
export function grokEffortValue(requested: ReasoningLevel): string {
  return requested === "low" ? "low" : "high";
}

// O(n) in flags
// SEC: every built-in tool is removed, web search and subagents are off, the sandbox is strict, approvals are never granted (dontAsk), the cwd is an empty temp dir
export function grokExecArgv(bin: string, req: LlmRequest, cwd: string, promptPath: string): string[] {
  const args = [bin, "--prompt-file", promptPath, "--output-format", "streaming-json", "--disallowed-tools", DENIED_TOOLS.join(","), "--disable-web-search", "--no-subagents", "--no-plan"];
  args.push("--max-turns", "1", "--permission-mode", "dontAsk", "--sandbox", "strict", "--system-prompt-override", GROK_SYSTEM, "--cwd", cwd);
  args.push("-m", req.model.id, "--reasoning-effort", grokEffortValue(req.reasoning));
  if (req.jsonSchema) args.push("--json-schema", JSON.stringify(req.jsonSchema));
  return args;
}

// O(n) in the CLI output
// SEC: the working directory is an empty temp dir (plus the prompt file) and is removed even when the call throws or aborts
// INV: images are not sent; the CLI rejected inline images in testing, so subscription models are listed as text-only
export async function* streamGrokEvents(req: LlmRequest, bin: string, run: (argv: readonly string[], prompt: string, signal: AbortSignal, cwd: string) => CodexRun): AsyncIterable<LlmEvent> {
  const cwd = mkdtempSync(join(tmpdir(), "btg-grok-"));
  let stop = (): void => undefined;
  try {
    const promptPath = join(cwd, "prompt.txt");
    writeFileSync(promptPath, renderCodexPrompt(req.system, req.messages));
    const started = run(grokExecArgv(bin, req, cwd, promptPath), "", req.signal, cwd);
    stop = started.stop;
    let finished = false;
    for await (const line of started.lines) {
      const parsed = parseGrokLine(line);
      if (parsed.toolType !== null) console.error(`grok: aborted on ${parsed.toolType}`);
      yield* parsed.events;
      if (parsed.abort || parsed.events.some((e) => e.type === "error")) {
        stop();
        return;
      }
      if (parsed.finished) finished = true;
    }
    if (req.signal.aborted) {
      const reason: unknown = req.signal.reason;
      if (reason instanceof DOMException && reason.name === "TimeoutError") yield { type: "error", code: "timeout" };
      return;
    }
    yield finished ? { type: "done" } : { type: "error", code: "provider_error" };
  } finally {
    stop();
    rmSync(cwd, { recursive: true, force: true });
  }
}
