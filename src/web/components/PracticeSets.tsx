import { useState, type JSX } from "react";
import { z } from "zod";
import { GenerateResponse, type PracticeSetSummary } from "../../shared/api.ts";
import { api } from "../api.ts";
import { Button } from "./Button.tsx";
import { ErrorBanner } from "./ErrorBanner.tsx";
import { Panel } from "./Panel.tsx";
import { relativeTime } from "./Sidebar.tsx";

type Pending = "delete" | "regenerate";

// O(1) plus one request
export async function deletePracticeSet(id: string): Promise<void> {
  await api(`/api/practice/sets/${id}`, z.void(), { method: "DELETE" });
}

// O(1) plus one generation
// INV: the server swaps the old set for the new one in one transaction, so a failed regeneration leaves the old set as it was
export async function regeneratePracticeSet(id: string): Promise<GenerateResponse> {
  return api(`/api/practice/sets/${id}/regenerate`, GenerateResponse, { method: "POST" });
}

// O(1)
// INV: both actions ask for confirmation first, because each removes the set's questions and the progress that came from them
function SetRow({ set, onChanged }: { set: PracticeSetSummary; onChanged: () => void }): JSX.Element {
  const [confirming, setConfirming] = useState<Pending | null>(null);
  const [busy, setBusy] = useState<Pending | null>(null);
  const [error, setError] = useState<unknown>(null);

  async function act(what: Pending): Promise<void> {
    setBusy(what);
    setError(null);
    try {
      if (what === "delete") await deletePracticeSet(set.id);
      else await regeneratePracticeSet(set.id);
      setConfirming(null);
      onChanged();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  }

  const label = set.request.trim() !== "" ? set.request : set.topic;
  return (
    <li className="flex flex-col gap-2 border-b border-border py-2.5 last:border-b-0">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium" title={label}>{label}</p>
          <p className="text-xs text-muted">
            {set.answered} / {set.questions} answered · {relativeTime(set.createdAt)}
          </p>
        </div>
        {confirming === null && (
          <div className="flex shrink-0 gap-1">
            <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => setConfirming("regenerate")} aria-label={`Regenerate ${label}`}>Regenerate</Button>
            <Button variant="danger" className="px-2 py-1 text-xs" onClick={() => setConfirming("delete")} aria-label={`Delete ${label}`}>Delete</Button>
          </div>
        )}
      </div>
      {confirming !== null && (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-muted">
            {confirming === "delete"
              ? "This removes the set's questions and the mastery and daily progress that came from them."
              : "This writes a new set on the same topic, then removes this one with its questions and the progress that came from them."}
          </p>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant={confirming === "delete" ? "danger" : "primary"} busy={busy === confirming} disabled={busy !== null} onClick={() => void act(confirming)}>
              {confirming === "delete" ? "Delete set" : "Regenerate set"}
            </Button>
            <Button variant="ghost" disabled={busy !== null} onClick={() => setConfirming(null)}>Cancel</Button>
          </div>
        </div>
      )}
      <ErrorBanner error={error} />
    </li>
  );
}

// O(n) in sets
export function PracticeSets({ sets, onChanged }: { sets: PracticeSetSummary[] | null; onChanged: () => void }): JSX.Element | null {
  if (sets === null || sets.length === 0) return null;
  return (
    <Panel as="aside" className="flex h-fit flex-col gap-1">
      <h2 className="display text-lg">Your practice sets</h2>
      <ul className="flex max-h-[28rem] flex-col overflow-y-auto">
        {sets.map((s) => <SetRow key={s.id} set={s} onChanged={onChanged} />)}
      </ul>
    </Panel>
  );
}
