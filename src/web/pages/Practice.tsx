import { useCallback, useEffect, useState, type JSX } from "react";
import { z } from "zod";
import { GenerateResponse, PRACTICE_SET_SIZE, QuestionPublic, StatsResponse, StyleSummary } from "../../shared/api.ts";
import { api } from "../api.ts";
import { Button } from "../components/Button.tsx";
import { ErrorBanner } from "../components/ErrorBanner.tsx";
import { Panel } from "../components/Panel.tsx";
import { QuestionCard } from "../components/QuestionCard.tsx";
import { Spinner } from "../components/Spinner.tsx";
import { UploadDrop } from "../components/UploadDrop.tsx";

type Goal = { done: number; target: number };

const FIELD = "rounded-xl border border-border bg-panel-2 px-3 py-2.5 text-sm outline-none focus:border-accent";

function GeneratePanel({ onGenerated }: { onGenerated: () => void }): JSX.Element {
  const [topic, setTopic] = useState("");
  const [styles, setStyles] = useState<StyleSummary[]>([]);
  const [styleId, setStyleId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let live = true;
    api("/api/styles", z.array(StyleSummary)).then((s) => live && setStyles(s), () => undefined);
    return () => {
      live = false;
    };
  }, []);

  const run = async (): Promise<void> => {
    if (topic.trim().length < 2 || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api("/api/questions/generate", GenerateResponse, { method: "POST", body: { topic: topic.trim(), ...(styleId ? { styleId } : {}) } });
      onGenerated();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel as="aside" className="flex h-fit flex-col gap-3">
      <h2 className="text-lg font-semibold">Generate a practice set</h2>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
      >
        <label className="flex flex-col gap-1 text-sm text-muted">
          Topic
          <input className={FIELD} value={topic} maxLength={120} placeholder="e.g. Newton's laws" onChange={(e) => setTopic(e.currentTarget.value)} />
        </label>
        <p className="text-sm text-muted">Each set has {PRACTICE_SET_SIZE} questions: one terminology, one conceptual, one multiple choice and one free response (a sandboxed Python exercise for programming and computational topics), modelled on standard homework and exam problems.</p>
        <label className="flex flex-col gap-1 text-sm text-muted">
          Style
          <select className={FIELD} value={styleId} onChange={(e) => setStyleId(e.currentTarget.value)}>
            <option value="">Standard</option>
            {styles.map((s) => (
              <option key={s.id} value={s.id}>
                {s.subject || "Uploaded style"} ({s.mime === "application/pdf" ? "PDF" : "PNG"})
              </option>
            ))}
          </select>
        </label>
        <Button type="submit" busy={busy} disabled={topic.trim().length < 2}>
          Generate
        </Button>
      </form>
      <UploadDrop
        onUploaded={(id, subject) => {
          setStyles((s) => (s.some((x) => x.id === id) ? s : [{ id, subject, mime: "image/png", createdAt: new Date().toISOString() }, ...s]));
          setStyleId(id);
          void api("/api/styles", z.array(StyleSummary)).then(setStyles, () => undefined);
        }}
      />
      <ErrorBanner error={error} onRetry={() => void run()} />
    </Panel>
  );
}

// O(n) in queue
// INV: the card stays on screen with its result until "Next"; only then does it leave the local queue
export function PracticePage(): JSX.Element {
  const [queue, setQueue] = useState<QuestionPublic[] | null>(null);
  const [answered, setAnswered] = useState(false);
  const [goal, setGoal] = useState<Goal | null>(null);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      const [q, s] = await Promise.all([api("/api/practice/queue?limit=20", z.array(QuestionPublic)), api("/api/stats?days=7", StatsResponse)]);
      setQueue(q);
      setAnswered(false);
      setGoal(s.totals.goalToday);
    } catch (e) {
      setError(e);
      setQueue((q) => q ?? []);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const card = queue?.[0];
  const pct = goal ? Math.min(100, Math.round((goal.done / goal.target) * 100)) : 0;

  return (
    <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="flex flex-col gap-3">
        <Panel className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between">
            <h1 className="text-3xl font-semibold">Practice</h1>
            {queue && <span className="text-sm text-muted">{queue.length} due</span>}
          </div>
          {goal && (
            <div>
              <p className="text-sm text-muted">
                Daily goal: {goal.done} / {goal.target}
              </p>
              <div className="mt-1 h-2 overflow-hidden rounded-full bg-border" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Daily goal">
                <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${pct}%` }} />
              </div>
            </div>
          )}
        </Panel>
        <ErrorBanner error={error} onRetry={() => void load()} />
        {queue === null && <Spinner label="Loading your queue" />}
        {queue?.length === 0 && (
          <Panel>
            <h2 className="text-xl font-semibold text-accent">All caught up</h2>
            <p className="mt-1 text-muted">Nothing is due right now. Generate a new practice set to keep going.</p>
          </Panel>
        )}
        {card && (
          <>
            <QuestionCard
              key={card.id}
              question={card}
              label="Question"
              onResult={() => {
                setAnswered(true);
                api("/api/stats?days=7", StatsResponse).then((s) => setGoal(s.totals.goalToday), () => undefined);
              }}
            />
            {answered && (
              <div className="flex justify-end">
                <Button
                  onClick={() => {
                    setQueue((q) => (q ? q.slice(1) : q));
                    setAnswered(false);
                  }}
                >
                  Next →
                </Button>
              </div>
            )}
          </>
        )}
      </div>
      <GeneratePanel onGenerated={() => void load()} />
    </div>
  );
}
