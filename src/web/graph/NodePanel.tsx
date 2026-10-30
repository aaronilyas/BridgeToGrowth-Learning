import { useState, type JSX } from "react";
import { useLocation } from "wouter";
import { GenerateResponse, LessonCreated } from "../../shared/api.ts";
import { api } from "../api.ts";
import { Button } from "../components/Button.tsx";
import { ErrorBanner } from "../components/ErrorBanner.tsx";
import { useSettings } from "../session.tsx";
import { hueOf, type GNode } from "./GraphView.tsx";

// O(1)
export function NodePanel({ node, onClose }: { node: GNode; onClose: () => void }): JSX.Element {
  const { settings } = useSettings();
  const [, navigate] = useLocation();
  const [busy, setBusy] = useState<"teach" | "practice" | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [last, setLast] = useState<"teach" | "practice">("teach");

  const run = async (mode: "teach" | "practice"): Promise<void> => {
    if (busy) return;
    setBusy(mode);
    setLast(mode);
    setError(null);
    try {
      if (mode === "teach") {
        const r = await api("/api/lessons", LessonCreated, { method: "POST", body: { prompt: node.name } });
        navigate(`/lesson/${r.lessonId}`);
      } else {
        await api("/api/questions/generate", GenerateResponse, { method: "POST", body: { topic: node.name, count: settings.bite.questionsPerSession } });
        navigate("/practice");
      }
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  };

  return (
    <aside className="absolute right-3 top-3 flex w-72 flex-col gap-3 rounded-2xl border border-border bg-panel p-4 shadow-lg" aria-label="Topic details">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold" title={node.name}>{node.name}</h2>
          <p className="flex items-center gap-2 text-xs text-muted">
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: hueOf(node.domain) }} />
            {node.domain}
          </p>
        </div>
        <button type="button" className="rounded-md px-2 py-1 text-muted hover:bg-panel-2 hover:text-text" aria-label="Close" onClick={onClose}>
          ✕
        </button>
      </div>
      <dl className="grid grid-cols-3 gap-2 text-center text-sm">
        <div className="rounded-xl bg-panel-2 p-2">
          <dt className="text-xs text-muted">Mastery</dt>
          <dd className="font-semibold">{Math.round(node.mastery * 100)}%</dd>
        </div>
        <div className="rounded-xl bg-panel-2 p-2">
          <dt className="text-xs text-muted">Attempts</dt>
          <dd className="font-semibold">{node.attempts}</dd>
        </div>
        <div className="rounded-xl bg-panel-2 p-2">
          <dt className="text-xs text-muted">Last seen</dt>
          <dd className="font-semibold">{node.lastSeenAt ? new Date(node.lastSeenAt).toLocaleDateString() : "—"}</dd>
        </div>
      </dl>
      <div className="flex gap-2">
        <Button className="flex-1" busy={busy === "teach"} disabled={busy !== null} onClick={() => void run("teach")}>
          Teach
        </Button>
        <Button variant="soft" className="flex-1" busy={busy === "practice"} disabled={busy !== null} onClick={() => void run("practice")}>
          Practice
        </Button>
      </div>
      {busy && <p className="text-xs text-muted">{busy === "teach" ? "Planning your lesson…" : "Writing practice questions…"}</p>}
      <ErrorBanner error={error} onRetry={() => void run(last)} />
    </aside>
  );
}
