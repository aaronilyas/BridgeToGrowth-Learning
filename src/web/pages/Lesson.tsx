import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import { useParams } from "wouter";
import { LessonDetail, StepPublic } from "../../shared/api.ts";
import { api } from "../api.ts";
import { ChatPanel } from "../components/ChatPanel.tsx";
import { ErrorBanner } from "../components/ErrorBanner.tsx";
import { Panel } from "../components/Panel.tsx";
import { Spinner } from "../components/Spinner.tsx";
import { Button } from "../components/Button.tsx";
import { StepSkeleton, StepView } from "../components/StepView.tsx";

type StepStatus = "done" | "current" | "todo";

// O(n) in steps
// INV: steps before the furthest opened one count as done; the open step is answered-or-current
export function LessonPage(): JSX.Element {
  const { id = "" } = useParams<{ id: string }>();
  const [lesson, setLesson] = useState<LessonDetail | null>(null);
  const [steps, setSteps] = useState<Record<number, StepPublic>>({});
  const [current, setCurrent] = useState(0);
  const [answered, setAnswered] = useState<ReadonlySet<number>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const inflight = useRef<number | null>(null);

  const openStep = useCallback(async (idx: number): Promise<void> => {
    if (inflight.current === idx) return;
    inflight.current = idx;
    setCurrent(idx);
    setError(null);
    setLoading(true);
    try {
      const s = await api(`/api/lessons/${id}/steps/${idx}`, StepPublic, { method: "POST" });
      setSteps((m) => ({ ...m, [idx]: s }));
    } catch (e) {
      setError(e);
    } finally {
      if (inflight.current === idx) inflight.current = null;
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    let live = true;
    setLesson(null);
    setSteps({});
    setAnswered(new Set());
    setError(null);
    api(`/api/lessons/${id}`, LessonDetail).then(
      (l) => {
        if (!live) return;
        setLesson(l);
        setSteps(Object.fromEntries(l.steps.map((s) => [s.idx, s])));
        const last = l.steps.length;
        if (last === 0) void openStep(0);
        else setCurrent(last - 1);
      },
      (e: unknown) => live && setError(e),
    );
    return () => {
      live = false;
    };
  }, [id, openStep]);

  if (!lesson) {
    return <Panel>{error ? <ErrorBanner error={error} /> : <Spinner label="Loading lesson" />}</Panel>;
  }

  const total = lesson.plan.steps.length;
  const opened = Math.max(-1, ...Object.keys(steps).map(Number));
  const statusOf = (i: number): StepStatus => (i === current ? "current" : answered.has(i) || i < opened ? "done" : "todo");
  const doneCount = lesson.plan.steps.filter((_, i) => statusOf(i) === "done" || (i === current && answered.has(i))).length;
  const pct = total === 0 ? 0 : Math.round((doneCount / total) * 100);
  const step = steps[current];
  const planned = lesson.plan.steps[current];

  return (
    <div className="grid grid-cols-1 gap-3 xl:grid-cols-[14rem_minmax(0,1fr)_21rem]">
      <Panel as="aside" className="h-fit">
        <h2 className="mb-3 text-sm font-medium text-muted">Today's Session</h2>
        <ol className="flex flex-col gap-1">
          {lesson.plan.steps.map((s, i) => {
            const st = statusOf(i);
            const label = st === "done" ? "Done" : st === "current" ? "In progress" : "Not started";
            return (
              <li key={`${i}-${s.title}`}>
                <button
                  type="button"
                  disabled={i > Object.keys(steps).length}
                  aria-current={st === "current" ? "step" : undefined}
                  onClick={() => void openStep(i)}
                  className={`flex w-full flex-col rounded-xl border px-3 py-2.5 text-left text-sm transition disabled:cursor-not-allowed disabled:opacity-60 ${st === "current" ? "border-accent/40 bg-accent-soft" : "border-transparent hover:bg-panel-2"}`}
                >
                  <span className="font-medium">
                    {i + 1}. {s.title}
                  </span>
                  <span className={`text-xs ${st === "done" ? "text-accent" : "text-muted"}`}>{label}</span>
                </button>
              </li>
            );
          })}
        </ol>
      </Panel>

      <Panel className="min-w-0">
        {step && planned ? (
          <>
            <StepView key={step.idx} step={step} total={total} summary={planned.summary} onResult={() => setAnswered((a) => new Set(a).add(step.idx))} />
            {answered.has(step.idx) && (
              <div className="mt-5 flex justify-end">
                {current + 1 < total ? (
                  <Button onClick={() => void openStep(current + 1)}>Next step →</Button>
                ) : (
                  <p className="text-sm font-semibold text-accent">Lesson complete. Head to Practice to lock it in.</p>
                )}
              </div>
            )}
          </>
        ) : loading ? (
          <StepSkeleton />
        ) : null}
        <div className="mt-4">
          <ErrorBanner error={error} onRetry={() => void openStep(current)} />
        </div>
      </Panel>

      <Panel as="aside" className="flex h-fit flex-col gap-4">
        <h2 className="text-lg font-semibold">Lesson Plan</h2>
        <div>
          <p className="text-sm text-muted">
            {doneCount} of {total} completed
          </p>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-border" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Lesson progress">
            <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${pct}%` }} />
          </div>
        </div>
        <div className="rounded-xl border border-border bg-panel-2 p-3 text-sm">
          <p className="font-semibold text-accent">Keep going!</p>
          <p className="text-muted">{lesson.title}</p>
        </div>
        <ChatPanel lessonId={lesson.id} />
      </Panel>
    </div>
  );
}
