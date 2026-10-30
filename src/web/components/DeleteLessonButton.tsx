import { useState, type JSX } from "react";
import { z } from "zod";
import { api } from "../api.ts";
import { Button } from "./Button.tsx";
import { stopLessonChat } from "./ChatPanel.tsx";
import { ErrorBanner } from "./ErrorBanner.tsx";

// O(1)
export function DeleteLessonButton({ lessonId, lessonTitle, onDeleted }: { lessonId: string; lessonTitle: string; onDeleted: () => void }): JSX.Element {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function remove(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/lessons/${lessonId}`, z.void(), { method: "DELETE" });
      stopLessonChat(lessonId);
      onDeleted();
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-2">
      {confirming ? (
        <>
          <p className="text-xs text-muted">This removes the lesson, its chat, its checks, and the mastery and daily progress that came from them.</p>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="danger" busy={busy} onClick={() => void remove()}>Delete lesson and its progress</Button>
            <Button variant="ghost" disabled={busy} onClick={() => setConfirming(false)}>Cancel</Button>
          </div>
        </>
      ) : (
        <Button variant="danger" onClick={() => setConfirming(true)} aria-label={`Delete ${lessonTitle}`}>Delete</Button>
      )}
      <ErrorBanner error={error} />
    </div>
  );
}
