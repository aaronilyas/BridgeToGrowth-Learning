import { expect, test } from "bun:test";
import type { LessonCheck } from "../../shared/api.ts";
import { answeredLine, captionOf } from "../components/QuestionCard.tsx";
import { mergeChatRows, type ChatRow } from "./chatStore.ts";
import { attemptMessage, currentTopic, openFollowUpId, splitFollowUp, topicAnchors, topicStatus, tutorFollowUp } from "./transcript.ts";

// O(1)
function row(id: string, role: ChatRow["role"], content: string, topicIdx: number | null): ChatRow {
  return { id, role, content, citations: [], pending: false, topicIdx, check: null, finishes: false, preparingCheck: false };
}

const CHECK: LessonCheck = { question: { id: "00000000-0000-4000-8000-000000000001", topicId: "00000000-0000-4000-8000-000000000002", kind: "free", category: null, stem: "Apply it.", choices: null, code: null, codeTests: null, lessonId: null }, lastAttempt: null };

test("the newest tutor message sets the topic, and each topic anchors to where it was first reached", () => {
  const rows = [row("1", "assistant", "a", 0), row("2", "user", "b", null), row("3", "assistant", "c", 1), row("4", "assistant", "d", 0), row("5", "user", "e", null)];
  expect(currentTopic(rows)).toBe(0);
  expect(currentTopic(rows.slice(0, 3))).toBe(1);
  expect(currentTopic([])).toBe(0);
  expect([...topicAnchors(rows)]).toEqual([[0, "1"], [1, "3"]]);
});

test("the Socratic turn is composed from what the learner sent", () => {
  const base = { choiceText: null, response: "", thinking: "", confidence: null, dontKnow: false };
  expect(attemptMessage({ ...base, kind: "mcq", choiceText: "It is unbiased", thinking: " averages cancel ", confidence: 70 })).toBe('I answered: "It is unbiased" (confidence 70%). My thinking: averages cancel');
  expect(attemptMessage({ ...base, kind: "mcq", choiceText: "B" })).toBe('I answered: "B".');
  expect(attemptMessage({ ...base, kind: "free", response: "the mean", confidence: 40 })).toBe("My answer: the mean (confidence 40%)");
  expect(attemptMessage({ ...base, kind: "code", response: "x = 1" })).toBe("I submitted this code:\n\n```python\nx = 1\n```");
  expect(attemptMessage({ ...base, kind: "free", response: "anything", dontKnow: true })).toBe("I don't know.");
  expect(attemptMessage({ ...base, kind: "free", response: "x".repeat(5000) }).length).toBe(4000);
});

test("a tutor turn's closing question splits off from its lead", () => {
  expect(splitFollowUp("Right about the sign.\n\nWhat changes if $x<0$?\n")).toEqual({ lead: "Right about the sign.", question: "What changes if $x<0$?" });
  expect(splitFollowUp("First.\n \nSecond.\n\n**Why does it hold?**")).toEqual({ lead: "First.\n \nSecond.", question: "**Why does it hold?**" });
  expect(splitFollowUp("Why does it hold? [2]")).toEqual({ lead: "", question: "Why does it hold? [2]" });
  expect(splitFollowUp("Here is the full derivation.")).toBeNull();
  expect(splitFollowUp("Why?\n\nThat is the key step.")).toBeNull();
  expect(splitFollowUp("")).toBeNull();
});

test("a turn that hands over to a check or closes the lesson has no follow-up", () => {
  const asked = row("2", "assistant", "Lead.\n\nReady for this one?", 1);
  expect(tutorFollowUp(asked)).toEqual({ lead: "Lead.", question: "Ready for this one?" });
  expect(tutorFollowUp({ ...asked, role: "user" })).toBeNull();
  expect(tutorFollowUp({ ...asked, pending: true })).toBeNull();
  expect(tutorFollowUp({ ...asked, finishes: true })).toBeNull();
  expect(tutorFollowUp({ ...asked, check: CHECK })).toBeNull();
});

test("only the newest settled tutor question is open", () => {
  const asked = row("2", "assistant", "Why?", 1);
  expect(openFollowUpId([row("1", "user", "hi", 1), asked], false)).toBe("2");
  expect(openFollowUpId([asked], true)).toBeNull();
  expect(openFollowUpId([{ ...asked, pending: true }], false)).toBeNull();
  expect(openFollowUpId([asked, row("3", "user", "because", 1)], false)).toBeNull();
  expect(openFollowUpId([{ ...asked, content: "No question here." }], false)).toBeNull();
  expect(openFollowUpId([{ ...asked, check: CHECK }], false)).toBeNull();
  expect(openFollowUpId([], false)).toBeNull();
});

test("topic status follows the tutor, not the learner's answers", () => {
  const reached = new Set([0, 1, 3]);
  expect(topicStatus(0, 1, reached, false)).toBe("done");
  expect(topicStatus(1, 1, reached, false)).toBe("current");
  expect(topicStatus(2, 1, reached, false)).toBe("todo");
  expect(topicStatus(3, 1, reached, false)).toBe("done");
  expect(topicStatus(1, 1, reached, true)).toBe("done");
});

test("an optimistic turn is dropped once history holds that same turn", () => {
  const history = [row("1", "user", "hi", 0), row("2", "assistant", "hello", 0)];
  const optimistic = [row("u-1", "user", "hi", 0), row("a-1", "assistant", "hello", 0)];
  expect(mergeChatRows(history, optimistic)).toEqual(history);
  expect(mergeChatRows(history.slice(0, 1), optimistic).map((r) => r.id)).toEqual(["1", "u-1", "a-1"]);
});

test("check captions and the saved-attempt line", () => {
  expect(captionOf({ kind: "mcq", category: "conceptual" })).toBe("Prediction");
  expect(captionOf({ kind: "code", category: "free" })).toBe("Code");
  expect(captionOf({ kind: "free", category: null })).toBe("Free response");
  expect(answeredLine({ score: 1, correct: true, confidence: 70, dontKnow: false })).toBe("Answered · correct · 70% confident");
  expect(answeredLine({ score: 0, correct: false, confidence: 0, dontKnow: true })).toBe("Answered · didn't know");
});
