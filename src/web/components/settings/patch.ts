import { Settings, type SettingsPatch } from "../../../shared/settings.ts";

const MODEL_TASKS = ["lesson", "chat", "practice", "system"] as const;

// O(1)
function sameChoice(left: Settings["models"]["lesson"], right: Settings["models"]["lesson"]): boolean {
  if (left === null || right === null) return left === right;
  return left.provider === right.provider && left.id === right.id;
}

// O(1)
export function settingsPatchOf(draft: Settings, saved: Settings): SettingsPatch {
  const patch: SettingsPatch = {};
  if (draft.level !== saved.level) patch.level = draft.level;
  if (draft.season !== saved.season) patch.season = draft.season;
  if (draft.budgetUsd !== saved.budgetUsd) patch.budgetUsd = draft.budgetUsd;
  if (draft.openalexMailto !== saved.openalexMailto) patch.openalexMailto = draft.openalexMailto;
  const models: NonNullable<SettingsPatch["models"]> = {};
  let modelCount = 0;
  for (const task of MODEL_TASKS) {
    if (sameChoice(draft.models[task], saved.models[task])) continue;
    models[task] = draft.models[task];
    modelCount += 1;
  }
  if (modelCount > 0) patch.models = models;
  if (draft.srs.enabled !== saved.srs.enabled || draft.srs.newPerDay !== saved.srs.newPerDay || draft.srs.maxReviewsPerDay !== saved.srs.maxReviewsPerDay) {
    const srs: NonNullable<SettingsPatch["srs"]> = {};
    if (draft.srs.enabled !== saved.srs.enabled) srs.enabled = draft.srs.enabled;
    if (draft.srs.newPerDay !== saved.srs.newPerDay) srs.newPerDay = draft.srs.newPerDay;
    if (draft.srs.maxReviewsPerDay !== saved.srs.maxReviewsPerDay) srs.maxReviewsPerDay = draft.srs.maxReviewsPerDay;
    patch.srs = srs;
  }
  if (draft.recall.freeResponseRatio !== saved.recall.freeResponseRatio || draft.recall.confidencePrompt !== saved.recall.confidencePrompt) {
    const recall: NonNullable<SettingsPatch["recall"]> = {};
    if (draft.recall.freeResponseRatio !== saved.recall.freeResponseRatio) recall.freeResponseRatio = draft.recall.freeResponseRatio;
    if (draft.recall.confidencePrompt !== saved.recall.confidencePrompt) recall.confidencePrompt = draft.recall.confidencePrompt;
    patch.recall = recall;
  }
  if (draft.bite.stepsPerLesson !== saved.bite.stepsPerLesson || draft.bite.maxWordsPerStep !== saved.bite.maxWordsPerStep || draft.bite.questionsPerSession !== saved.bite.questionsPerSession) {
    const bite: NonNullable<SettingsPatch["bite"]> = {};
    if (draft.bite.stepsPerLesson !== saved.bite.stepsPerLesson) bite.stepsPerLesson = draft.bite.stepsPerLesson;
    if (draft.bite.maxWordsPerStep !== saved.bite.maxWordsPerStep) bite.maxWordsPerStep = draft.bite.maxWordsPerStep;
    if (draft.bite.questionsPerSession !== saved.bite.questionsPerSession) bite.questionsPerSession = draft.bite.questionsPerSession;
    patch.bite = bite;
  }
  if (draft.practice.dailyGoal !== saved.practice.dailyGoal) patch.practice = { dailyGoal: draft.practice.dailyGoal };
  const limits: NonNullable<SettingsPatch["limits"]> = {};
  if (draft.limits.timeoutSeconds !== saved.limits.timeoutSeconds) limits.timeoutSeconds = draft.limits.timeoutSeconds;
  if (draft.limits.thinkingTokens !== saved.limits.thinkingTokens) limits.thinkingTokens = draft.limits.thinkingTokens;
  if (draft.limits.answerScale !== saved.limits.answerScale) limits.answerScale = draft.limits.answerScale;
  if (Object.keys(limits).length > 0) patch.limits = limits;
  return patch;
}
