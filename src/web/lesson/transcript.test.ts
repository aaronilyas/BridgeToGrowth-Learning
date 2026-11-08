import { expect, test } from "bun:test";
import { answeredLine, captionOf } from "../components/QuestionCard.tsx";
import { keepCited, mergeChatRows, type ChatRow } from "./chatStore.ts";
import { attemptMessage, groupRows, openFollowUpId, splitFollowUp, stepStatus } from "./transcript.ts";

// O(1)
function row(id: string, role: ChatRow["role"], content: string, stepIdx: number | null): ChatRow {
  return { id, role, content, citations: [], pending: false, stepIdx };
}

test("rows group under their step; legacy and unopened-step rows go after the last step", () => {
  const rows = [row("1", "user", "old", null), row("2", "user", "a", 0), row("3", "assistant", "b", 0), row("4", "user", "c", 1), row("5", "user", "future", 4)];
  const { byStep, tail } = groupRows(rows, 1);
  expect(byStep.get(0)?.map((r) => r.id)).toEqual(["2", "3"]);
  expect(byStep.get(1)?.map((r) => r.id)).toEqual(["4"]);
  expect(tail.map((r) => r.id)).toEqual(["1", "5"]);
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

test("only the newest settled tutor question on the newest step is open", () => {
  const asked = row("2", "assistant", "Why?", 1);
  expect(openFollowUpId([row("1", "user", "hi", 1), asked], 1, false)).toBe("2");
  expect(openFollowUpId([asked], 1, true)).toBeNull();
  expect(openFollowUpId([{ ...asked, pending: true }], 1, false)).toBeNull();
  expect(openFollowUpId([asked, row("3", "user", "because", 1)], 1, false)).toBeNull();
  expect(openFollowUpId([asked], 2, false)).toBeNull();
  expect(openFollowUpId([{ ...asked, content: "No question here." }], 1, false)).toBeNull();
  expect(openFollowUpId([{ ...asked, stepIdx: null }], 2, false)).toBe("2");
  expect(openFollowUpId([], 0, false)).toBeNull();
});

test("step status: attempted is done, newest unattempted is current, unopened is todo", () => {
  const answered = new Set([0]);
  expect(stepStatus(0, 2, answered)).toBe("done");
  expect(stepStatus(1, 2, answered)).toBe("done");
  expect(stepStatus(2, 2, answered)).toBe("current");
  expect(stepStatus(3, 2, answered)).toBe("todo");
});

test("an optimistic turn is dropped once history holds that same turn", () => {
  const history = [row("1", "user", "hi", 0), row("2", "assistant", "hello", 0)];
  const optimistic = [row("u-1", "user", "hi", 0), row("a-1", "assistant", "hello", 0)];
  expect(mergeChatRows(history, optimistic)).toEqual(history);
  expect(mergeChatRows(history.slice(0, 1), optimistic).map((r) => r.id)).toEqual(["1", "u-1", "a-1"]);
  expect(keepCited("a [1] b [2]", [{ n: 1, paperId: "p", doi: null, title: "t", year: null }])).toBe("a [1] b ");
});

test("check captions and the saved-attempt line", () => {
  expect(captionOf({ kind: "mcq", category: "conceptual" })).toBe("Prediction");
  expect(captionOf({ kind: "code", category: "free" })).toBe("Code");
  expect(captionOf({ kind: "free", category: null })).toBe("Free response");
  expect(answeredLine({ score: 1, correct: true, confidence: 70, dontKnow: false })).toBe("Answered · correct · 70% confident");
  expect(answeredLine({ score: 0, correct: false, confidence: 0, dontKnow: true })).toBe("Answered · didn't know");
});
