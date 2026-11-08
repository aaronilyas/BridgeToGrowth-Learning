import { z } from "zod";
import { ProviderId } from "./providers.ts";

const int = (min: number, max: number) => z.int().min(min).max(max);

export const SETTINGS_LIMITS = {
  srs: { newPerDay: { min: 0, max: 50 }, maxReviewsPerDay: { min: 0, max: 500 }, repetitions: { min: 1, max: 10 } },
  recall: { freeResponseRatio: { min: 0, max: 1 } },
  bite: { topicsPerLesson: { min: 2, max: 16 }, maxWordsPerTurn: { min: 60, max: 400 }, questionsPerSession: { min: 3, max: 20 } },
  practice: { dailyGoal: { min: 1, max: 100 } },
  limits: { timeoutSeconds: { min: 30, max: 900 }, thinkingTokens: { min: 1000, max: 64000 }, answerScale: { min: 0.5, max: 4 } },
} as const;

export const LIMIT_DEFAULTS = { timeoutSeconds: 120, thinkingTokens: 12000, answerScale: 1 } as const;

const level = z.enum(["undergrad", "grad"]);
const season = z.enum(["auto", "spring", "summer", "fall", "winter"]);
const model = z.string().min(1).max(100).nullable();
const modelTask = z.enum(["lesson", "chat", "practice", "system"]);
const modelChoice = z.strictObject({ provider: ProviderId, id: z.string().min(1).max(200) }).nullable();
const taskModels = {
  lesson: modelChoice.default(null),
  chat: modelChoice.default(null),
  practice: modelChoice.default(null),
  system: modelChoice.default(null),
};
const srs = { enabled: z.boolean(), newPerDay: int(SETTINGS_LIMITS.srs.newPerDay.min, SETTINGS_LIMITS.srs.newPerDay.max), maxReviewsPerDay: int(SETTINGS_LIMITS.srs.maxReviewsPerDay.min, SETTINGS_LIMITS.srs.maxReviewsPerDay.max), repetitions: int(SETTINGS_LIMITS.srs.repetitions.min, SETTINGS_LIMITS.srs.repetitions.max) };
const recall = { freeResponseRatio: z.number().min(SETTINGS_LIMITS.recall.freeResponseRatio.min).max(SETTINGS_LIMITS.recall.freeResponseRatio.max), confidencePrompt: z.boolean() };
const bite = { topicsPerLesson: int(SETTINGS_LIMITS.bite.topicsPerLesson.min, SETTINGS_LIMITS.bite.topicsPerLesson.max), maxWordsPerTurn: int(SETTINGS_LIMITS.bite.maxWordsPerTurn.min, SETTINGS_LIMITS.bite.maxWordsPerTurn.max), questionsPerSession: int(SETTINGS_LIMITS.bite.questionsPerSession.min, SETTINGS_LIMITS.bite.questionsPerSession.max) };
const practice = { dailyGoal: int(SETTINGS_LIMITS.practice.dailyGoal.min, SETTINGS_LIMITS.practice.dailyGoal.max) };
const L = SETTINGS_LIMITS.limits;
const limits = { timeoutSeconds: int(L.timeoutSeconds.min, L.timeoutSeconds.max), thinkingTokens: int(L.thinkingTokens.min, L.thinkingTokens.max), answerScale: z.number().min(L.answerScale.min).max(L.answerScale.max) };

// INV: parse({}) yields full defaults; nested groups use prefault so inner defaults apply
export const Settings = z.strictObject({
  level: level.default("undergrad"),
  model: model.default(null),
  models: z.strictObject(taskModels).prefault({}),
  budgetUsd: z.number().min(0).max(1_000_000).nullable().default(null),
  staleModels: z.array(modelTask).default([]),
  season: season.default("auto"),
  openalexMailto: z.string().max(254).default(""),
  srs: z.strictObject({ enabled: srs.enabled.default(true), newPerDay: srs.newPerDay.default(10), maxReviewsPerDay: srs.maxReviewsPerDay.default(50), repetitions: srs.repetitions.default(3) }).prefault({}),
  recall: z.strictObject({ freeResponseRatio: recall.freeResponseRatio.default(0.3), confidencePrompt: recall.confidencePrompt.default(true) }).prefault({}),
  bite: z.strictObject({ topicsPerLesson: bite.topicsPerLesson.default(4), maxWordsPerTurn: bite.maxWordsPerTurn.default(180), questionsPerSession: bite.questionsPerSession.default(8) }).prefault({}),
  practice: z.strictObject({ dailyGoal: practice.dailyGoal.default(10) }).prefault({}),
  limits: z.strictObject({ timeoutSeconds: limits.timeoutSeconds.default(LIMIT_DEFAULTS.timeoutSeconds), thinkingTokens: limits.thinkingTokens.default(LIMIT_DEFAULTS.thinkingTokens), answerScale: limits.answerScale.default(LIMIT_DEFAULTS.answerScale) }).prefault({}),
});
export type Settings = z.infer<typeof Settings>;

export const SettingsPatch = z.strictObject({
  level: level.optional(),
  model: model.optional(),
  models: z.strictObject({ lesson: modelChoice.optional(), chat: modelChoice.optional(), practice: modelChoice.optional(), system: modelChoice.optional() }).optional(),
  budgetUsd: z.number().min(0).max(1_000_000).nullable().optional(),
  season: season.optional(),
  openalexMailto: z.string().max(254).optional(),
  srs: z.strictObject({ enabled: srs.enabled.optional(), newPerDay: srs.newPerDay.optional(), maxReviewsPerDay: srs.maxReviewsPerDay.optional(), repetitions: srs.repetitions.optional() }).optional(),
  recall: z.strictObject({ freeResponseRatio: recall.freeResponseRatio.optional(), confidencePrompt: recall.confidencePrompt.optional() }).optional(),
  bite: z.strictObject({ topicsPerLesson: bite.topicsPerLesson.optional(), maxWordsPerTurn: bite.maxWordsPerTurn.optional(), questionsPerSession: bite.questionsPerSession.optional() }).optional(),
  practice: z.strictObject({ dailyGoal: practice.dailyGoal.optional() }).optional(),
  limits: z.strictObject({ timeoutSeconds: limits.timeoutSeconds.optional(), thinkingTokens: limits.thinkingTokens.optional(), answerScale: limits.answerScale.optional() }).optional(),
});
export type SettingsPatch = z.infer<typeof SettingsPatch>;

const MODEL_TASKS = ["lesson", "chat", "practice", "system"] as const;

// O(1)
// INV: the result is unvalidated; callers must run it through Settings.parse before storing
// INV: a model whose provider is absent from `connected` becomes null and its task is listed in staleModels
export function mergeSettings(current: Settings, patch: SettingsPatch, connected?: ReadonlySet<string>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...current };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    const prev = out[k];
    out[k] = typeof v === "object" && v !== null && typeof prev === "object" && prev !== null ? { ...prev, ...Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined)) } : v;
  }
  if (connected !== undefined) {
    const models = { ...(out.models as Settings["models"]) };
    const stale: string[] = [];
    for (const task of MODEL_TASKS) {
      const choice = models[task];
      if (choice !== null && !connected.has(choice.provider)) {
        models[task] = null;
        stale.push(task);
      }
    }
    out.models = models;
    out.staleModels = stale;
  }
  return out;
}
