import type { QuestionPublic } from "../../shared/api.ts";
import type { ChatRow } from "./chatStore.ts";

export type TopicStatus = "done" | "current" | "todo";

// What the learner sent with a check, so the tutor can be told in their own words.
export type SentAttempt = { kind: QuestionPublic["kind"]; choiceText: string | null; response: string; thinking: string; confidence: number | null; dontKnow: boolean };

const MAX_MESSAGE = 4000;

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
