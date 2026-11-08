import type { QuestionPublic } from "../../shared/api.ts";
import type { ChatRow } from "./chatStore.ts";

export type TopicStatus = "done" | "current" | "todo";

// What the learner sent with a check, so the tutor can be told in their own words.
export type SentAttempt = { kind: QuestionPublic["kind"]; choiceText: string | null; response: string; thinking: string; confidence: number | null; dontKnow: boolean };

const MAX_MESSAGE = 4000;
const CLOSING_QUESTION = /\?(?:[*_"'”’)]|\s*\[\d+\])*$/;

// O(n) in rows
// INV: the newest row with a topic decides; a lesson nothing has been said in starts on topic 0
export function currentTopic(rows: readonly ChatRow[]): number {
  return rows.findLast((r) => r.topicIdx !== null)?.topicIdx ?? 0;
}

// O(n) in rows
// INV: maps each topic the tutor has reached to the row that first reached it, for jumping from the topic list
export function topicAnchors(rows: readonly ChatRow[]): Map<number, string> {
  const anchors = new Map<number, string>();
  for (const r of rows) {
    if (r.topicIdx !== null && !anchors.has(r.topicIdx)) anchors.set(r.topicIdx, r.id);
  }
  return anchors;
}

// O(n) in message length
// INV: only a final paragraph ending in "?" counts as the tutor's question; it is returned as written, and the saved message is never changed
export function splitFollowUp(content: string): { lead: string; question: string } | null {
  const text = content.trimEnd();
  const last = text.split(/\n[ \t]*\n/).at(-1) ?? "";
  if (!CLOSING_QUESTION.test(last)) return null;
  return { lead: text.slice(0, text.length - last.length).trimEnd(), question: last.trim() };
}

// O(n) in message length
// INV: a turn that hands over to a check or closes the lesson has no follow-up, so the learner is never shown two questions at once
export function tutorFollowUp(row: ChatRow): { lead: string; question: string } | null {
  if (row.role !== "assistant" || row.pending || row.check !== null || row.finishes) return null;
  return splitFollowUp(row.content);
}

// O(n) in the last message
// INV: only the newest settled tutor turn can be answered; a turn the learner replied to is closed
export function openFollowUpId(rows: readonly ChatRow[], streaming: boolean): string | null {
  const last = rows.at(-1);
  if (streaming || !last) return null;
  return tutorFollowUp(last) ? last.id : null;
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
// INV: the tutor's current topic is current until the lesson closes; a topic it has reached and left is done; a topic it has not reached is todo
export function topicStatus(i: number, current: number, reached: ReadonlySet<number>, finished: boolean): TopicStatus {
  if (i === current && !finished) return "current";
  return reached.has(i) ? "done" : "todo";
}
