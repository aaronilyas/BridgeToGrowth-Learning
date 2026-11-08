import type { QuestionPublic } from "../../shared/api.ts";
import type { ChatRow } from "./chatStore.ts";

export type StepStatus = "done" | "current" | "todo";

// What the learner sent with a check, so the tutor can be told in their own words.
export type SentAttempt = { kind: QuestionPublic["kind"]; choiceText: string | null; response: string; thinking: string; confidence: number | null; dontKnow: boolean };

const MAX_MESSAGE = 4000;
const CLOSING_QUESTION = /\?(?:[*_"'”’)]|\s*\[\d+\])*$/;

// O(n) in rows
// INV: rows keep their order inside a step; legacy rows (stepIdx null) and rows for steps not opened yet go to `tail`, after the last step
export function groupRows(rows: readonly ChatRow[], opened: number): { byStep: Map<number, ChatRow[]>; tail: ChatRow[] } {
  const byStep = new Map<number, ChatRow[]>();
  const tail: ChatRow[] = [];
  for (const r of rows) {
    if (r.stepIdx === null || r.stepIdx > opened) {
      tail.push(r);
      continue;
    }
    const list = byStep.get(r.stepIdx);
    if (list) list.push(r);
    else byStep.set(r.stepIdx, [r]);
  }
  return { byStep, tail };
}

// O(n) in message length
// INV: only a final paragraph ending in "?" counts as the tutor's question; it is returned as written, and the saved message is never changed
export function splitFollowUp(content: string): { lead: string; question: string } | null {
  const text = content.trimEnd();
  const last = text.split(/\n[ \t]*\n/).at(-1) ?? "";
  if (!CLOSING_QUESTION.test(last)) return null;
  return { lead: text.slice(0, text.length - last.length).trimEnd(), question: last.trim() };
}

// O(n) in the last message
// INV: only the newest settled tutor turn can be answered, and only while its step is still the newest; a turn the learner replied to or moved past is closed
export function openFollowUpId(rows: readonly ChatRow[], newest: number, streaming: boolean): string | null {
  const last = rows.at(-1);
  if (streaming || !last || last.role !== "assistant" || last.pending) return null;
  if (last.stepIdx !== null && last.stepIdx < newest) return null;
  return splitFollowUp(last.content) ? last.id : null;
}

// O(1)
function conf(c: number | null): string {
  return c === null ? "" : ` (confidence ${c}%)`;
}

// O(n) in answer length
// INV: the result fits ChatRequest.message (1..4000 chars), and never reveals more than the learner typed or chose
export function attemptMessage(a: SentAttempt): string {
  if (a.dontKnow) return "I don't know.";
  let msg: string;
  if (a.kind === "mcq") {
    msg = `I answered: "${a.choiceText ?? ""}"${conf(a.confidence)}.`;
    if (a.thinking.trim() !== "") msg += ` My thinking: ${a.thinking.trim()}`;
  } else if (a.kind === "code") msg = `I submitted this code${conf(a.confidence)}:\n\n\`\`\`python\n${a.response}\n\`\`\``;
  else msg = `My answer: ${a.response.trim()}${conf(a.confidence)}`;
  return msg.length > MAX_MESSAGE ? `${msg.slice(0, MAX_MESSAGE - 1)}…` : msg;
}

// O(1)
// INV: a step is done once its check has an attempt; the newest opened step is current until then; unopened steps are todo
export function stepStatus(i: number, newest: number, answered: ReadonlySet<number>): StepStatus {
  if (answered.has(i)) return "done";
  if (i === newest) return "current";
  return i < newest ? "done" : "todo";
}
