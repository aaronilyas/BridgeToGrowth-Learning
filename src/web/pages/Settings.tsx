import { useCallback, useEffect, useState, type JSX } from "react";
import { ModelsResponse } from "../../shared/api.ts";
import { SeasonResponse } from "../../shared/season.ts";
import type { Settings } from "../../shared/settings.ts";
import { api, describeError } from "../api.ts";
import { Button } from "../components/Button.tsx";
import { ConnectionCards } from "../components/connections/ConnectionCards.tsx";
import { BudgetField } from "../components/settings/BudgetField.tsx";
import { DisplayFields } from "../components/settings/DisplayFields.tsx";
import { DataSection } from "../components/settings/DataSection.tsx";
import { LimitFields } from "../components/settings/LimitFields.tsx";
import { LearningFields } from "../components/settings/LearningFields.tsx";
import { ModelFields } from "../components/settings/ModelFields.tsx";
import { settingsPatchOf } from "../components/settings/patch.ts";
import { UpdateSection } from "../components/settings/UpdateSection.tsx";
import { useSettings } from "../session.tsx";

// O(1)
export function SettingsPage(): JSX.Element {
  const { settings, updateSettings } = useSettings();
  const [autoSeason, setAutoSeason] = useState(settings.season);
  const [models, setModels] = useState<ModelsResponse>([]);
  const [draft, setDraft] = useState(settings);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);

  const loadModels = useCallback(async (): Promise<void> => {
    try {
      setModels(await api("/api/models", ModelsResponse));
    } catch (cause) {
      setFailed(true);
      setMessage(describeError(cause));
    }
  }, []);

  useEffect(() => {
    setDraft(settings);
  }, [settings]);

  useEffect(() => {
    void loadModels();
    void api("/api/season", SeasonResponse).then((response) => setAutoSeason(response.season), () => undefined);
  }, [loadModels]);

  function chooseSeason(value: Settings["season"]): void {
    setDraft((old) => ({ ...old, season: value }));
    document.documentElement.dataset.season = value === "auto" ? autoSeason : value;
  }

  async function saveSettings(): Promise<void> {
    const patch = settingsPatchOf(draft, settings);
    if (Object.keys(patch).length === 0) {
      setFailed(false);
      setMessage("Nothing to save.");
      return;
    }
    setSaving(true);
    setMessage("");
    try {
      await updateSettings(patch);
      setFailed(false);
      setMessage("Settings saved.");
    } catch (cause) {
      setFailed(true);
      setMessage(describeError(cause));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto grid max-w-3xl gap-5">
      <header>
        <h1 className="display text-2xl">Settings</h1>
        <p className="mt-1 text-sm text-muted">Connect a provider, pick default models, set model limits, tune learning, and update the app.</p>
      </header>
      <section className="grid gap-3">
        <div>
          <h2 className="display text-lg">AI connections</h2>
          <p className="mt-1 text-sm text-muted">A key is checked when you save it, then stored in the system keychain. It is not shown again.</p>
        </div>
        <ConnectionCards onChanged={loadModels} />
      </section>
      <ModelFields models={models} draft={draft} stale={settings.staleModels} setDraft={setDraft} />
      <LimitFields draft={draft} setDraft={setDraft} />
      <BudgetField value={draft.budgetUsd} onChange={(value) => setDraft((old) => ({ ...old, budgetUsd: value }))} />
      <DataSection email={draft.openalexMailto} onEmail={(value) => setDraft((old) => ({ ...old, openalexMailto: value }))} />
      <LearningFields draft={draft} setDraft={setDraft} onSeason={chooseSeason} />
      <DisplayFields />
      <div className="flex items-center justify-end gap-4">
        {message && <span role="status" className={`text-sm ${failed ? "text-danger" : "text-muted"}`}>{message}</span>}
        <Button onClick={() => void saveSettings()} busy={saving}>Save settings</Button>
      </div>
      <UpdateSection />
    </div>
  );
}
