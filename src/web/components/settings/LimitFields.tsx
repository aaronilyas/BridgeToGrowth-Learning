import type { Dispatch, JSX, SetStateAction } from "react";
import { SETTINGS_LIMITS, type Settings } from "../../../shared/settings.ts";
import { fieldClass, SettingsNumber, SettingsSection } from "./controls.tsx";

const L = SETTINGS_LIMITS.limits;
const ANSWER_SCALES = [
  { value: 0.5, label: "Shorter (0.5×)" },
  { value: 1, label: "Default (1×)" },
  { value: 1.5, label: "Longer (1.5×)" },
  { value: 2, label: "Much longer (2×)" },
  { value: 4, label: "Maximum (4×)" },
] as const;

// O(1)
export function LimitFields({ draft, setDraft }: { draft: Settings; setDraft: Dispatch<SetStateAction<Settings>> }): JSX.Element {
  function set<K extends keyof Settings["limits"]>(key: K, value: Settings["limits"][K]): void {
    setDraft((old) => ({ ...old, limits: { ...old.limits, [key]: value } }));
  }
  const scales = ANSWER_SCALES.some((s) => s.value === draft.limits.answerScale) ? ANSWER_SCALES : [...ANSWER_SCALES, { value: draft.limits.answerScale, label: `${draft.limits.answerScale}×` }];
  return (
    <SettingsSection title="Model limits" hint="How long a model may take and how many tokens it may spend on each request. Slow or thinking-heavy models may need more time; more tokens can cost more." columns>
      <SettingsNumber label={`Response time limit (seconds, ${L.timeoutSeconds.min}–${L.timeoutSeconds.max})`} value={draft.limits.timeoutSeconds} min={L.timeoutSeconds.min} max={L.timeoutSeconds.max} onChange={(value) => set("timeoutSeconds", value)} />
      <SettingsNumber label={`Thinking tokens (${L.thinkingTokens.min.toLocaleString()}–${L.thinkingTokens.max.toLocaleString()})`} value={draft.limits.thinkingTokens} min={L.thinkingTokens.min} max={L.thinkingTokens.max} step={1000} onChange={(value) => set("thinkingTokens", value)} />
      <label className="grid gap-1 text-sm">
        Answer length
        <select className={fieldClass} value={draft.limits.answerScale} onChange={(event) => set("answerScale", Number(event.currentTarget.value))}>
          {scales.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </label>
      <p className="self-end text-xs text-muted">Thinking tokens apply only to models that reason before answering. Answer length scales the token cap each feature sets for its reply. Token limits apply to API-key connections; Codex and Grok sign-ins manage their own. The time limit applies to every connection.</p>
    </SettingsSection>
  );
}
