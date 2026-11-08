import type { Dispatch, JSX, SetStateAction } from "react";
import { SETTINGS_LIMITS, type Settings } from "../../../shared/settings.ts";
import { fieldClass, SettingsNumber, SettingsSection, SettingsToggle } from "./controls.tsx";

const SEASONS = ["auto", "spring", "summer", "fall", "winter"] as const;
const S = SETTINGS_LIMITS.srs;

// O(1)
export function LearningFields({ draft, setDraft, onSeason }: { draft: Settings; setDraft: Dispatch<SetStateAction<Settings>>; onSeason: (season: Settings["season"]) => void }): JSX.Element {
  function setSrsNumber(key: "newPerDay" | "maxReviewsPerDay" | "repetitions", value: number): void {
    setDraft((old) => ({ ...old, srs: { ...old.srs, [key]: value } }));
  }
  return (
    <>
      <SettingsSection title="Spaced repetition" hint="These ranges follow learning research. Each question gets at least three spaced reviews, and the longest gap is about one year." columns>
        <SettingsToggle label="Enable spaced repetition" checked={draft.srs.enabled} onChange={(value) => setDraft((old) => ({ ...old, srs: { ...old.srs, enabled: value } }))} />
        <SettingsNumber label={`New cards per day (${S.newPerDay.min}–${S.newPerDay.max})`} value={draft.srs.newPerDay} min={S.newPerDay.min} max={S.newPerDay.max} onChange={(value) => setSrsNumber("newPerDay", value)} />
        <SettingsNumber label={`Maximum reviews per day (${S.maxReviewsPerDay.min}–${S.maxReviewsPerDay.max})`} value={draft.srs.maxReviewsPerDay} min={S.maxReviewsPerDay.min} max={S.maxReviewsPerDay.max} onChange={(value) => setSrsNumber("maxReviewsPerDay", value)} />
        <SettingsNumber label={`Reviews per question (${S.repetitions.min}–${S.repetitions.max})`} value={draft.srs.repetitions} min={S.repetitions.min} max={S.repetitions.max} onChange={(value) => setSrsNumber("repetitions", value)} />
      </SettingsSection>
      <SettingsSection title="Active recall">
        <SettingsToggle label="Ask for confidence after each answer" checked={draft.recall.confidencePrompt} onChange={(value) => setDraft((old) => ({ ...old, recall: { ...old.recall, confidencePrompt: value } }))} />
      </SettingsSection>
      <SettingsSection title="Bite-sized learning" columns>
        <SettingsNumber label="Topics per lesson" value={draft.bite.topicsPerLesson} min={SETTINGS_LIMITS.bite.topicsPerLesson.min} max={SETTINGS_LIMITS.bite.topicsPerLesson.max} onChange={(value) => setDraft((old) => ({ ...old, bite: { ...old.bite, topicsPerLesson: value } }))} />
        <SettingsNumber label="Maximum words per tutor message" value={draft.bite.maxWordsPerTurn} min={SETTINGS_LIMITS.bite.maxWordsPerTurn.min} max={SETTINGS_LIMITS.bite.maxWordsPerTurn.max} onChange={(value) => setDraft((old) => ({ ...old, bite: { ...old.bite, maxWordsPerTurn: value } }))} />
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
