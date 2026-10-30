import { useEffect, useState, type JSX, type ReactNode } from "react";
import { z } from "zod";
import { ModelsResponse } from "../../shared/api.ts";
import { SeasonResponse } from "../../shared/season.ts";
import { Settings, SETTINGS_LIMITS } from "../../shared/settings.ts";
import { api, describeError } from "../api.ts";
import { Button } from "../components/Button.tsx";
import { Panel } from "../components/Panel.tsx";
import { Slider } from "../components/Slider.tsx";
import { useSeason, useSettings } from "../session.tsx";

const NumberField = z.number();
function Section({ title, children }: { title: string; children: ReactNode }): JSX.Element { return <Panel><h2 className="mb-4 text-lg font-semibold">{title}</h2><div className="grid gap-5 sm:grid-cols-2">{children}</div></Panel>; }
function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }): JSX.Element { return <label className="flex items-center gap-3 text-sm"><input type="checkbox" checked={checked} onChange={(e) => onChange(e.currentTarget.checked)} className="size-4 accent-accent" />{label}</label>; }

// O(1)
export function SettingsPage(): JSX.Element {
  const { settings, updateSettings } = useSettings();
  const activeSeason = useSeason();
  const [autoSeason, setAutoSeason] = useState(activeSeason);
  const [models, setModels] = useState<ModelsResponse>([]);
  const [draft, setDraft] = useState(settings);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => { setDraft(settings); }, [settings]);
  useEffect(() => {
    void api("/api/models", ModelsResponse).then(setModels).catch(() => setMessage("Models could not be loaded."));
    void api("/api/season", SeasonResponse).then((response) => setAutoSeason(response.season), () => undefined);
  }, []);
  function setNumber(path: "srs.newPerDay" | "srs.maxReviewsPerDay" | "bite.stepsPerLesson" | "bite.maxWordsPerStep" | "bite.questionsPerSession" | "practice.dailyGoal", value: number): void {
    const [group, key] = path.split(".") as ["srs" | "bite" | "practice", string];
    setDraft((old) => ({ ...old, [group]: { ...old[group], [key]: NumberField.parse(value) } }));
  }
  const modelId = models.some((m) => m.id === draft.model) ? (draft.model ?? "") : (models[0]?.id ?? "");
  async function saveSettings(): Promise<void> {
    setSaving(true); setMessage("");
    const patch: Record<string, unknown> = {};
    for (const key of ["level", "season"] as const) if (draft[key] !== settings[key]) patch[key] = draft[key];
    if (modelId && modelId !== settings.model) patch.model = modelId;
    for (const group of ["srs", "recall", "bite", "practice"] as const) {
      const changed = Object.fromEntries(Object.entries(draft[group]).filter(([key, value]) => value !== settings[group][key as keyof typeof settings[typeof group]]));
      if (Object.keys(changed).length) patch[group] = changed;
    }
    try { await updateSettings(patch); setMessage("Settings saved."); } catch (error) { setMessage(describeError(error)); } finally { setSaving(false); }
  }
  function setSeason(value: Settings["season"]): void { setDraft((old) => ({ ...old, season: value })); document.documentElement.dataset.season = value === "auto" ? autoSeason : value; }
  const input = "rounded-lg border border-border bg-panel-2 px-3 py-2 text-text";
  return <div className="mx-auto grid max-w-3xl gap-5"><header><h1 className="text-2xl font-semibold">Settings</h1><p className="mt-1 text-sm text-muted">Tune your learning experience.</p></header>
    <Section title="Spaced repetition"><Toggle label="Enable spaced repetition" checked={draft.srs.enabled} onChange={(v) => setDraft((d) => ({ ...d, srs: { ...d.srs, enabled: v } }))} />
      <label className="grid gap-1 text-sm">New cards per day<input className={input} type="number" min={SETTINGS_LIMITS.srs.newPerDay.min} max={SETTINGS_LIMITS.srs.newPerDay.max} value={draft.srs.newPerDay} onChange={(e) => setNumber("srs.newPerDay", Number(e.currentTarget.value))} /></label>
      <label className="grid gap-1 text-sm">Maximum reviews per day<input className={input} type="number" min={SETTINGS_LIMITS.srs.maxReviewsPerDay.min} max={SETTINGS_LIMITS.srs.maxReviewsPerDay.max} value={draft.srs.maxReviewsPerDay} onChange={(e) => setNumber("srs.maxReviewsPerDay", Number(e.currentTarget.value))} /></label></Section>
    <Section title="Active recall"><Slider label="Free response" min={SETTINGS_LIMITS.recall.freeResponseRatio.min} max={SETTINGS_LIMITS.recall.freeResponseRatio.max} step={0.05} value={draft.recall.freeResponseRatio} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => setDraft((d) => ({ ...d, recall: { ...d.recall, freeResponseRatio: v } }))} /><Toggle label="Ask for confidence after each answer" checked={draft.recall.confidencePrompt} onChange={(v) => setDraft((d) => ({ ...d, recall: { ...d.recall, confidencePrompt: v } }))} /></Section>
    <Section title="Bite-sized learning"><NumberInput label="Steps per lesson" value={draft.bite.stepsPerLesson} min={SETTINGS_LIMITS.bite.stepsPerLesson.min} max={SETTINGS_LIMITS.bite.stepsPerLesson.max} onChange={(v) => setNumber("bite.stepsPerLesson", v)} /><NumberInput label="Maximum words per step" value={draft.bite.maxWordsPerStep} min={SETTINGS_LIMITS.bite.maxWordsPerStep.min} max={SETTINGS_LIMITS.bite.maxWordsPerStep.max} onChange={(v) => setNumber("bite.maxWordsPerStep", v)} /><NumberInput label="Questions per session" value={draft.bite.questionsPerSession} min={SETTINGS_LIMITS.bite.questionsPerSession.min} max={SETTINGS_LIMITS.bite.questionsPerSession.max} onChange={(v) => setNumber("bite.questionsPerSession", v)} /></Section>
    <Section title="Daily practice"><NumberInput label="Daily goal" value={draft.practice.dailyGoal} min={SETTINGS_LIMITS.practice.dailyGoal.min} max={SETTINGS_LIMITS.practice.dailyGoal.max} onChange={(v) => setNumber("practice.dailyGoal", v)} /></Section>
    <Section title="Model"><label className="grid gap-1 text-sm">Preferred model<select className={input} value={modelId} onChange={(e) => setDraft((d) => ({ ...d, model: e.currentTarget.value }))}>{models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</select></label><label className="grid gap-1 text-sm">Learning level<select className={input} value={draft.level} onChange={(e) => setDraft((d) => ({ ...d, level: e.currentTarget.value as typeof d.level }))}><option value="undergrad">Undergraduate</option><option value="grad">Graduate</option></select></label></Section>
    <Section title="Appearance"><label className="grid gap-1 text-sm">Season<select className={input} value={draft.season} onChange={(e) => setSeason(e.currentTarget.value as Settings["season"])}>{["auto", "spring", "summer", "fall", "winter"].map((s) => <option key={s} value={s}>{s[0]?.toUpperCase()}{s.slice(1)}</option>)}</select></label></Section>
    <div className="flex items-center justify-end gap-4">{message && <span role="status" className="text-sm text-muted">{message}</span>}<Button onClick={() => void saveSettings()} busy={saving}>Save settings</Button></div>
  </div>;
}

function NumberInput({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (value: number) => void }): JSX.Element { return <label className="grid gap-1 text-sm">{label}<input className="rounded-lg border border-border bg-panel-2 px-3 py-2 text-text" type="number" min={min} max={max} value={value} onChange={(e) => onChange(Math.max(min, Math.min(max, Number(e.currentTarget.value))))} /></label>; }
