import { expect, test } from "bun:test";
import { Settings, SettingsPatch, mergeSettings } from "../../shared/settings.ts";
import { completionBudget } from "./core.ts";

test("default limits keep the previous two-minute deadline and 12k thinking budget", () => {
  expect(Settings.parse({}).limits).toEqual({ timeoutSeconds: 120, thinkingTokens: 12000, answerScale: 1 });
});

test("stored settings without limits still parse", () => {
  expect(Settings.parse({ level: "grad" }).limits.timeoutSeconds).toBe(120);
});

test("a limits patch merges into saved settings and is range-checked", () => {
  const merged = Settings.parse(mergeSettings(Settings.parse({}), { limits: { timeoutSeconds: 300 } }));
  expect(merged.limits).toEqual({ timeoutSeconds: 300, thinkingTokens: 12000, answerScale: 1 });
  expect(SettingsPatch.safeParse({ limits: { timeoutSeconds: 5 } }).success).toBe(false);
  expect(SettingsPatch.safeParse({ limits: { thinkingTokens: 999_999 } }).success).toBe(false);
});

test("the completion budget scales the answer and adds thinking only for reasoning models", () => {
  const limits = { thinkingTokens: 8000, answerScale: 1.5 };
  expect(completionBudget(1000, limits, false)).toBe(1500);
  expect(completionBudget(1000, limits, true)).toBe(9500);
  expect(completionBudget(1, { thinkingTokens: 1000, answerScale: 0.5 }, false)).toBe(1);
});
