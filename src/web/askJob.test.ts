import { beforeEach, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beginAskJob, failAskJob, finishAskJob, generatingLessonPrompt, getAskJob, resetAskJob, subscribeAskJob } from "./askJob.ts";
import { GeneratingLesson } from "./pages/Teach.tsx";

beforeEach(() => {
  resetAskJob();
});

test("the requested lesson stays visible after the teach page unsubscribes", () => {
  const seen: string[] = [];
  const stop = subscribeAskJob(() => {
    const job = getAskJob();
    seen.push(job === null ? "clear" : `${job.phase}:${job.text}`);
  });
  const id = beginAskJob({ mode: "teach", text: "separable differential equations", model: "" });
  expect(id).toBeNumber();
  stop();
  expect(getAskJob()).toEqual({ mode: "teach", text: "separable differential equations", model: "", phase: "running", error: null });
  expect(generatingLessonPrompt(getAskJob())).toBe("separable differential equations");
  expect(beginAskJob({ mode: "teach", text: "integrals", model: "" })).toBeNull();
  expect(seen).toEqual(["running:separable differential equations"]);
  if (id === null) throw new Error("expected a job id");
  finishAskJob(id);
  expect(getAskJob()).toBeNull();
  expect(seen).toEqual(["running:separable differential equations"]);
});

test("a stale settle cannot replace the lesson requested later", () => {
  const first = beginAskJob({ mode: "teach", text: "derivatives", model: "a" });
  if (first === null) throw new Error("expected a job id");
  failAskJob(first, new Error("upstream"));
  expect(getAskJob()?.phase).toBe("error");
  expect(getAskJob()?.text).toBe("derivatives");
  const second = beginAskJob({ mode: "teach", text: "integrals", model: "b" });
  if (second === null) throw new Error("expected a job id");
  finishAskJob(first);
  failAskJob(first, new Error("late"));
  expect(getAskJob()).toEqual({ mode: "teach", text: "integrals", model: "b", phase: "running", error: null });
  finishAskJob(second);
  expect(getAskJob()).toBeNull();
  expect(generatingLessonPrompt(getAskJob())).toBeNull();
});

test("the teach page lists the lesson still being planned", () => {
  const prompt = generatingLessonPrompt(getAskJob());
  expect(prompt).toBeNull();
  const id = beginAskJob({ mode: "teach", text: "separable differential equations", model: "" });
  const requested = generatingLessonPrompt(getAskJob());
  expect(requested).toBe("separable differential equations");
  const html = renderToStaticMarkup(createElement(GeneratingLesson, { prompt: requested ?? "" }));
  expect(html).toContain("separable differential equations");
  expect(html).toContain("Finding papers and planning your lesson…");
  expect(html).toContain('aria-busy="true"');
  if (id === null) throw new Error("expected a job id");
  finishAskJob(id);
  beginAskJob({ mode: "practice", text: "practice only", model: "" });
  expect(generatingLessonPrompt(getAskJob())).toBeNull();
});
