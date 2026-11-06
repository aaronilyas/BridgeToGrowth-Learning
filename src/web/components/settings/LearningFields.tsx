import type { Dispatch, JSX, SetStateAction } from "react";
import { SETTINGS_LIMITS, type Settings } from "../../../shared/settings.ts";
import { fieldClass, SettingsNumber, SettingsSection, SettingsToggle } from "./controls.tsx";

const SEASONS = ["auto", "spring", "summer", "fall", "winter"] as const;

// O(1)
export function LearningFields({ draft, setDraft, onSeason }: { draft: Settings; setDraft: Dispatch<SetStateAction<Settings>>; onSeason: (season: Settings["season"]) => void }): JSX.Element {
  function setSrsNumber(key: "newPerDay" | "maxReviewsPerDay" | "repetitions", value: number): void {
    setDraft((old) => ({ ...old, srs: { ...old.srs, [key]: value } }));
  }
  return (
    <>
      <SettingsSection title="Spaced repetition" columns>
        <SettingsToggle label="Enable spaced repetition" checked={draft.srs.enabled} onChange={(value) => setDraft((old) => ({ ...old, srs: { ...old.srs, enabled: value } }))} />
        <SettingsNumber label="New cards per day" value={draft.srs.newPerDay} min={SETTINGS_LIMITS.srs.newPerDay.min} max={SETTINGS_LIMITS.srs.newPerDay.max} onChange={(value) => setSrsNumber("newPerDay", value)} />
        <SettingsNumber label="Maximum reviews per day" value={draft.srs.maxReviewsPerDay} min={SETTINGS_LIMITS.srs.maxReviewsPerDay.min} max={SETTINGS_LIMITS.srs.maxReviewsPerDay.max} onChange={(value) => setSrsNumber("maxReviewsPerDay", value)} />
        <SettingsNumber label="Reviews per question" value={draft.srs.repetitions} min={SETTINGS_LIMITS.srs.repetitions.min} max={SETTINGS_LIMITS.srs.repetitions.max} onChange={(value) => setSrsNumber("repetitions", value)} />
      </SettingsSection>
      <SettingsSection title="Active recall">
        <SettingsToggle label="Ask for confidence after each answer" checked={draft.recall.confidencePrompt} onChange={(value) => setDraft((old) => ({ ...old, recall: { ...old.recall, confidencePrompt: value } }))} />
      </SettingsSection>
      <SettingsSection title="Bite-sized learning" columns>
        <SettingsNumber label="Steps per lesson" value={draft.bite.stepsPerLesson} min={SETTINGS_LIMITS.bite.stepsPerLesson.min} max={SETTINGS_LIMITS.bite.stepsPerLesson.max} onChange={(value) => setDraft((old) => ({ ...old, bite: { ...old.bite, stepsPerLesson: value } }))} />
        <SettingsNumber label="Maximum words per step" value={draft.bite.maxWordsPerStep} min={SETTINGS_LIMITS.bite.maxWordsPerStep.min} max={SETTINGS_LIMITS.bite.maxWordsPerStep.max} onChange={(value) => setDraft((old) => ({ ...old, bite: { ...old.bite, maxWordsPerStep: value } }))} />
      </SettingsSection>
      <SettingsSection title="Daily practice">
        <SettingsNumber label="Daily goal" value={draft.practice.dailyGoal} min={SETTINGS_LIMITS.practice.dailyGoal.min} max={SETTINGS_LIMITS.practice.dailyGoal.max} onChange={(value) => setDraft((old) => ({ ...old, practice: { ...old.practice, dailyGoal: value } }))} />
      </SettingsSection>
      <SettingsSection title="Level" columns>
        <label className="grid gap-1 text-sm">
          Learning level
          <select className={fieldClass} value={draft.level} onChange={(event) => setDraft((old) => ({ ...old, level: event.currentTarget.value === "grad" ? "grad" : "undergrad" }))}>
            <option value="undergrad">Undergraduate</option>
            <option value="grad">Graduate</option>
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          Season
          <select className={fieldClass} value={draft.season} onChange={(event) => onSeason(SEASONS.find((season) => season === event.currentTarget.value) ?? "auto")}>
            {SEASONS.map((season) => <option key={season} value={season}>{season[0]?.toUpperCase()}{season.slice(1)}</option>)}
          </select>
        </label>
      </SettingsSection>
    </>
  );
}
