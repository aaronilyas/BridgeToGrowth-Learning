import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type JSX } from "react";
import { Link, useLocation, useParams } from "wouter";
import { LessonDetail, StepPublic, type AttemptResponse } from "../../shared/api.ts";
import { api } from "../api.ts";
import { ErrorBanner } from "../components/ErrorBanner.tsx";
import { Spinner } from "../components/Spinner.tsx";
import { StepSkeleton, StepView } from "../components/StepView.tsx";
import { lessonsChanged, useLessonChat } from "../lesson/chatStore.ts";
import { Composer, type Seed } from "../lesson/Composer.tsx";
import { Messages } from "../lesson/Messages.tsx";
import { PlanPanel } from "../lesson/PlanPanel.tsx";
import { attemptMessage, groupRows, stepStatus, type SentAttempt } from "../lesson/transcript.ts";

const PLAN_KEY = "btg:lesson-plan-open";
const NEAR_BOTTOM_PX = 96;

// O(1)
function readPlanOpen(): boolean {
  try {
    return localStorage.getItem(PLAN_KEY) === "1";
  } catch {
    return false;
  }
}

// O(1)
function StatusBadge({ teaching }: { teaching: boolean }): JSX.Element {
  return (
    <span role="status" className="label flex items-center gap-2 text-text">
      <span aria-hidden="true" className={`inline-block size-3 rounded-full border-[1.5px] ${teaching ? "animate-spin border-muted border-t-transparent motion-reduce:animate-none" : "border-accent"}`} />
      {teaching ? "Teaching" : "Your turn"}
    </span>
  );
}

// O(s + m) per render in opened steps and chat rows; steps are memoised, so a streamed delta re-renders only the streaming row
// INV: steps open strictly in order; the newest opened step anchors composer turns
// INV: a check result immediately sends one chat turn anchored to that step (the Socratic reply); if a turn is already streaming the reply is left in the composer
export function LessonPage(): JSX.Element {
  const { id = "" } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const [lesson, setLesson] = useState<LessonDetail | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [steps, setSteps] = useState<Record<number, StepPublic>>({});
  const [generating, setGenerating] = useState<number | null>(null);
  const [stepError, setStepError] = useState<{ idx: number; error: unknown } | null>(null);
  const [planOpen, setPlanOpen] = useState(readPlanOpen);
  const [seed, setSeed] = useState<Seed | null>(null);
  const chat = useLessonChat(id);
  const { send } = chat;
  const inflight = useRef<number | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const jumpTo = useRef<number | null>(null);

  // O(1) plus one request
  const openStep = useCallback(async (idx: number): Promise<void> => {
    if (inflight.current === idx) return;
    inflight.current = idx;
    setGenerating(idx);
    setStepError(null);
    try {
      const s = await api(`/api/lessons/${id}/steps/${idx}`, StepPublic, { method: "POST" });
      if (inflight.current !== idx) return;
      jumpTo.current = idx;
      setSteps((m) => ({ ...m, [idx]: s }));
      lessonsChanged();
    } catch (e) {
      if (inflight.current === idx) setStepError({ idx, error: e });
    } finally {
      if (inflight.current === idx) {
        inflight.current = null;
        setGenerating(null);
      }
    }
  }, [id]);

  useEffect(() => {
    let live = true;
    inflight.current = null;
    stick.current = true;
    setLesson(null);
    setLoadError(null);
    setSteps({});
    setGenerating(null);
    setStepError(null);
    api(`/api/lessons/${id}`, LessonDetail).then(
      (l) => {
        if (!live) return;
        setLesson(l);
        setSteps(Object.fromEntries(l.steps.map((s) => [s.idx, s])));
        if (l.steps.length === 0 && l.plan.steps.length > 0) void openStep(0);
      },
      (e: unknown) => live && setLoadError(e),
    );
    return () => {
      live = false;
    };
  }, [id, openStep]);

  // A failed turn comes back to the composer so it can be edited or resent.
  useEffect(() => {
    if (chat.error && chat.retry) setSeed({ text: chat.retry.text, n: Date.now() });
  }, [chat.error, chat.retry]);

  // O(1)
  const onResult = useCallback((idx: number, r: AttemptResponse, sent: SentAttempt): void => {
    setSteps((m) => {
      const s = m[idx];
      return s ? { ...m, [idx]: { ...s, lastAttempt: { score: r.score, correct: r.correct, confidence: sent.confidence, dontKnow: sent.dontKnow } } } : m;
    });
    lessonsChanged();
    const text = attemptMessage(sent);
    stick.current = true;
    if (!send({ text, stepIdx: idx })) setSeed({ text, n: Date.now() });
  }, [send]);

  // INV: follow new content only while the reader is already near the bottom; a newly opened step scrolls to its start instead
  const loaded = lesson !== null;
  useEffect(() => {
    const el = scroller.current;
    const inner = content.current;
    if (!loaded || !el || !inner) return;
    const onScroll = (): void => {
      stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
    };
    const ro = new ResizeObserver(() => {
      const j = jumpTo.current;
      const target = j === null ? null : document.getElementById(`step-${j}`);
      if (target) {
        jumpTo.current = null;
        stick.current = false;
        target.scrollIntoView({ block: "start" });
      } else if (stick.current) el.scrollTop = el.scrollHeight;
    });
    el.addEventListener("scroll", onScroll, { passive: true });
    ro.observe(inner);
    return () => {
      el.removeEventListener("scroll", onScroll);
      ro.disconnect();
    };
  }, [loaded]);

  const newest = useMemo(() => Math.max(-1, ...Object.keys(steps).map(Number)), [steps]);
  const groups = useMemo(() => groupRows(chat.rows, newest), [chat.rows, newest]);

  if (!lesson) {
    return <div className="grid flex-1 place-items-center">{loadError ? <ErrorBanner error={loadError} /> : <Spinner label="Loading lesson" />}</div>;
  }

  const total = lesson.plan.steps.length;
  const answered = new Set(Object.values(steps).filter((s) => s.lastAttempt !== null).map((s) => s.idx));
  const statusOf = (i: number) => stepStatus(i, newest, answered);
  const teaching = generating !== null || chat.streaming;
  const canContinue = newest >= 0 && answered.has(newest) && !teaching;
  const togglePlan = (): void => {
    const next = !planOpen;
    setPlanOpen(next);
    try {
      localStorage.setItem(PLAN_KEY, next ? "1" : "0");
    } catch {
      // storage unavailable: the toggle still works for this visit
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center gap-4 border-b border-border px-8 py-4">
        <h1 className="display min-w-0 flex-1 truncate text-3xl">{lesson.title}</h1>
        <button
          type="button"
          aria-pressed={planOpen}
          aria-controls="lesson-plan"
          onClick={togglePlan}
          className={`label rounded-full border px-3 py-1 transition hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${planOpen ? "border-muted text-text" : "border-border"}`}
        >
          Plan
        </button>
        <StatusBadge teaching={teaching} />
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <div ref={scroller} className="scroll-quiet min-h-0 flex-1 overflow-y-auto">
            <div ref={content} aria-live="polite" aria-relevant="additions" aria-busy={teaching} aria-label="Lesson transcript" className="mx-auto flex max-w-[52rem] flex-col gap-10 px-8 py-8 leading-relaxed">
              {Array.from({ length: newest + 1 }, (_, i) => {
                const s = steps[i];
                return (
                  <Fragment key={i}>
                    {s && <StepView step={s} total={total} onResult={onResult} />}
                    <Messages rows={groups.byStep.get(i)} />
                  </Fragment>
                );
              })}
              <Messages rows={groups.tail} />
              {generating !== null && <StepSkeleton />}
              {stepError && <ErrorBanner error={stepError.error} onRetry={() => void openStep(stepError.idx)} />}
              {total === 0 && <p className="text-sm text-muted">This lesson has no steps.</p>}
            </div>
          </div>

          <div className="mx-auto flex w-full max-w-[52rem] flex-col gap-2 px-8 pt-2 pb-4">
            {canContinue && (
              <div className="flex justify-center">
                {newest + 1 < total ? (
                  <button type="button" onClick={() => void openStep(newest + 1)} className="rounded-lg px-3 py-1.5 font-mono text-xs text-muted transition hover:bg-panel-2 hover:text-text focus-visible:outline-2 focus-visible:outline-accent">
                    Continue to step {newest + 2} →
                  </button>
                ) : (
                  <p className="font-mono text-xs text-muted">
                    Lesson complete —{" "}
                    <Link href="/practice" className="text-accent underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-accent">
                      practice it later
                    </Link>
                  </p>
                )}
              </div>
            )}
            <ErrorBanner error={chat.error} onRetry={() => chat.retry && send(chat.retry)} />
            <Composer streaming={chat.streaming} onSend={(text) => send({ text, stepIdx: newest >= 0 ? newest : null })} onStop={chat.stop} seed={seed} />
          </div>
        </div>
        {planOpen && (
          <PlanPanel
            lesson={lesson}
            statusOf={statusOf}
            opened={(i) => steps[i] !== undefined}
            onJump={(i) => document.getElementById(`step-${i}`)?.scrollIntoView({ block: "start", behavior: "smooth" })}
            onDeleted={() => {
              lessonsChanged();
              navigate("/teach");
            }}
          />
        )}
      </div>
    </div>
  );
}
