import { z } from "zod";

const int = (min: number, max: number) => z.int().min(min).max(max);

const level = z.enum(["undergrad", "grad"]);
const season = z.enum(["auto", "spring", "summer", "fall", "winter"]);
const model = z.string().min(1).max(100).nullable();
const srs = { enabled: z.boolean(), newPerDay: int(0, 50), maxReviewsPerDay: int(0, 500) };
const recall = { freeResponseRatio: z.number().min(0).max(1), confidencePrompt: z.boolean() };
const bite = { stepsPerLesson: int(2, 8), maxWordsPerStep: int(60, 400), questionsPerSession: int(3, 20) };
const practice = { dailyGoal: int(1, 100) };

// INV: parse({}) yields full defaults; nested groups use prefault so inner defaults apply
export const Settings = z.strictObject({
  level: level.default("undergrad"),
  model: model.default(null),
  season: season.default("auto"),
  srs: z.strictObject({ enabled: srs.enabled.default(true), newPerDay: srs.newPerDay.default(10), maxReviewsPerDay: srs.maxReviewsPerDay.default(50) }).prefault({}),
  recall: z.strictObject({ freeResponseRatio: recall.freeResponseRatio.default(0.3), confidencePrompt: recall.confidencePrompt.default(true) }).prefault({}),
  bite: z.strictObject({ stepsPerLesson: bite.stepsPerLesson.default(4), maxWordsPerStep: bite.maxWordsPerStep.default(180), questionsPerSession: bite.questionsPerSession.default(8) }).prefault({}),
  practice: z.strictObject({ dailyGoal: practice.dailyGoal.default(10) }).prefault({}),
});
export type Settings = z.infer<typeof Settings>;

export const SettingsPatch = z.strictObject({
  level: level.optional(),
  model: model.optional(),
  season: season.optional(),
  srs: z.strictObject({ enabled: srs.enabled.optional(), newPerDay: srs.newPerDay.optional(), maxReviewsPerDay: srs.maxReviewsPerDay.optional() }).optional(),
  recall: z.strictObject({ freeResponseRatio: recall.freeResponseRatio.optional(), confidencePrompt: recall.confidencePrompt.optional() }).optional(),
  bite: z.strictObject({ stepsPerLesson: bite.stepsPerLesson.optional(), maxWordsPerStep: bite.maxWordsPerStep.optional(), questionsPerSession: bite.questionsPerSession.optional() }).optional(),
  practice: z.strictObject({ dailyGoal: practice.dailyGoal.optional() }).optional(),
});
export type SettingsPatch = z.infer<typeof SettingsPatch>;

// O(1)
// INV: the result is unvalidated; callers must run it through Settings.parse before storing
export function mergeSettings(current: Settings, patch: SettingsPatch): Record<string, unknown> {
  const out: Record<string, unknown> = { ...current };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    const prev = out[k];
    out[k] = typeof v === "object" && v !== null && typeof prev === "object" && prev !== null ? { ...prev, ...Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined)) } : v;
  }
  return out;
}
