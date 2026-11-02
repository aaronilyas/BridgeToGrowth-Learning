import type { Dispatch, JSX, SetStateAction } from "react";
import type { ModelsResponse } from "../../../shared/api.ts";
import type { ModelRef, ProviderId } from "../../../shared/providers.ts";
import type { Settings } from "../../../shared/settings.ts";
import { titleOfProvider } from "../../providerCopy.ts";
import { fieldClass, SettingsSection } from "./controls.tsx";

const TASKS = [
  { task: "lesson", label: "Lessons", hint: "" },
  { task: "chat", label: "Chat", hint: "" },
  { task: "practice", label: "Practice generation", hint: "" },
  { task: "system", label: "System", hint: "Grading, extraction and insights." },
] as const;

const PROVIDER_ORDER: readonly ProviderId[] = ["openrouter", "codex", "spacexai"];

type Choice = Settings["models"]["lesson"];

// O(1)
function encodeModelChoice(model: { provider: string; id: string }): string {
  return JSON.stringify([model.provider, model.id]);
}

// O(n) in the model list
function choiceFromValue(value: string, models: readonly ModelRef[]): Choice {
  const found = models.find((model) => encodeModelChoice(model) === value);
  return found === undefined ? null : { provider: found.provider, id: found.id };
}

// O(1)
function TraitBadge({ children }: { children: string }): JSX.Element {
  return <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent">{children}</span>;
}

// O(n) in the model list
export function ModelFields({ models, draft, stale, setDraft }: { models: ModelsResponse; draft: Settings; stale: Settings["staleModels"]; setDraft: Dispatch<SetStateAction<Settings>> }): JSX.Element {
  return (
    <SettingsSection title="Default models" hint="Any model from a connected provider can be picked. Save settings to keep these choices.">
      {models.length === 0 && <p className="text-sm text-muted">Connect a provider to load models.</p>}
      {TASKS.map((task) => {
        const choice = draft.models[task.task];
        const selected = choice === null ? undefined : models.find((model) => model.provider === choice.provider && model.id === choice.id);
        const needsChoice = stale.includes(task.task) && choice === null;
        return (
          <label key={task.task} className="grid gap-2 text-sm">
            <span className="font-medium">{task.label}</span>
            {task.hint !== "" && <span className="text-xs text-muted">{task.hint}</span>}
            <select
              className={fieldClass}
              aria-label={task.label}
              value={choice === null ? "" : encodeModelChoice(choice)}
              onChange={(event) => {
                const next = choiceFromValue(event.currentTarget.value, models);
                setDraft((old) => ({ ...old, models: { ...old.models, [task.task]: next } }));
              }}
            >
              <option value="">Choose a model</option>
              {PROVIDER_ORDER.map((provider) => {
                const rows = models.filter((model) => model.provider === provider);
                if (rows.length === 0) return null;
                return (
                  <optgroup key={provider} label={titleOfProvider(provider)}>
                    {rows.map((model) => (
                      <option key={encodeModelChoice(model)} value={encodeModelChoice(model)}>
                        {model.label}{model.vision ? " · vision" : ""}{model.reasoning.length > 0 ? ` · ${model.reasoning.join(", ")}` : ""}
                      </option>
                    ))}
                  </optgroup>
                );
              })}
              {choice !== null && selected === undefined && <option value={encodeModelChoice(choice)}>{titleOfProvider(choice.provider)} · {choice.id}</option>}
            </select>
            {selected && (
              <span className="flex flex-wrap gap-1">
                {selected.vision && <TraitBadge>Vision</TraitBadge>}
                {selected.reasoning.map((level) => <TraitBadge key={level}>{level}</TraitBadge>)}
              </span>
            )}
            {needsChoice && <span className="text-danger">This saved model was cleared because its provider is disconnected. Pick a new one.</span>}
          </label>
        );
      })}
    </SettingsSection>
  );
}
