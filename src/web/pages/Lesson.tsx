import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from "react";
import { Link, useLocation, useParams } from "wouter";
import { LessonDetail, type AttemptResponse, type CheckAttempt } from "../../shared/api.ts";
import { api } from "../api.ts";
import { ErrorBanner } from "../components/ErrorBanner.tsx";
import { Spinner } from "../components/Spinner.tsx";
import { lessonsChanged, useLessonChat } from "../lesson/chatStore.ts";
import { Composer, type Seed } from "../lesson/Composer.tsx";
import { Messages } from "../lesson/Messages.tsx";
import { PlanPanel } from "../lesson/PlanPanel.tsx";
import { attemptMessage, currentTopic, openFollowUpId, topicAnchors, topicStatus, type SentAttempt } from "../lesson/transcript.ts";

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

// O(m) per render in chat rows; rows are memoised, so a streamed delta re-renders only the streaming row
// INV: the tutor opens an empty lesson by itself and decides from then on when to change topic or ask a check; nothing here gates or advances the lesson
// INV: a check result immediately sends one chat turn naming that check (the Socratic reply); if a turn is already streaming the reply is left in the composer
export function LessonPage(): JSX.Element {
  const { id = "" } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const [lesson, setLesson] = useState<LessonDetail | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [planOpen, setPlanOpen] = useState(readPlanOpen);
  const [seed, setSeed] = useState<Seed | null>(null);
  const [answered, setAnswered] = useState<Record<string, CheckAttempt>>({});
  const chat = useLessonChat(id);
  const { send } = chat;
  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  useEffect(() => {
    let live = true;
    stick.current = true;
    setLesson(null);
    setLoadError(null);
    setAnswered({});
    api(`/api/lessons/${id}`, LessonDetail).then(
      (l) => {
        if (live) setLesson(l);
      },
      (e: unknown) => live && setLoadError(e),
    );
    return () => {
      live = false;
    };
  }, [id]);

  const lessonReady = lesson?.id === id;
  const unstarted = chat.ready && chat.rows.length === 0 && !chat.streaming && chat.error === null;
  useEffect(() => {
    if (lessonReady && unstarted) send({ text: "", checkId: null, opening: true });
  }, [lessonReady, unstarted, send]);

  // A failed turn comes back to the composer so it can be edited or resent.
  useEffect(() => {
    if (chat.error && chat.retry && !chat.retry.opening) setSeed({ text: chat.retry.text, n: Date.now() });
  }, [chat.error, chat.retry]);

  // O(1)
  const onResult = useCallback((questionId: string, r: AttemptResponse, sent: SentAttempt): void => {
    setAnswered((m) => ({ ...m, [questionId]: { score: r.score, correct: r.correct, confidence: sent.confidence, dontKnow: sent.dontKnow } }));
    lessonsChanged();
    const text = attemptMessage(sent);
    stick.current = true;
    if (!send({ text, checkId: questionId })) setSeed({ text, n: Date.now() });
  }, [send]);

  // INV: follow new content only while the reader is already near the bottom
  const loaded = lesson !== null;
  useEffect(() => {
    const el = scroller.current;
    const inner = content.current;
    if (!loaded || !el || !inner) return;
    const onScroll = (): void => {
      stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
    };
    const ro = new ResizeObserver(() => {
      if (stick.current) el.scrollTop = el.scrollHeight;
    });
    el.addEventListener("scroll", onScroll, { passive: true });
    ro.observe(inner);
    return () => {
      el.removeEventListener("scroll", onScroll);
      ro.disconnect();
    };
  }, [loaded]);

  const anchors = useMemo(() => topicAnchors(chat.rows), [chat.rows]);
  const openId = openFollowUpId(chat.rows, chat.streaming);

  // O(1)
  // INV: a follow-up answer is an ordinary chat turn, so it names no check and nothing is graded
  const onReply = useCallback((sent: SentAttempt): void => {
    const text = attemptMessage(sent);
    stick.current = true;
    if (!send({ text, checkId: null })) setSeed({ text, n: Date.now() });
  }, [send]);

  if (!lesson) {
    return <div className="grid flex-1 place-items-center">{loadError ? <ErrorBanner error={loadError} /> : <Spinner label="Loading lesson" />}</div>;
  }

  const current = currentTopic(chat.rows);
  const finished = chat.rows.some((r) => r.finishes);
  const teaching = chat.streaming;
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
          Topics
        </button>
        <StatusBadge teaching={teaching} />
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <div ref={scroller} className="scroll-quiet min-h-0 flex-1 overflow-y-auto">
            <div ref={content} aria-live="polite" aria-relevant="additions" aria-busy={teaching} aria-label="Lesson transcript" className="mx-auto flex max-w-[46rem] flex-col gap-8 px-8 pt-10 pb-16">
              <Messages rows={chat.rows} anchors={anchors} answered={answered} onResult={onResult} openId={openId} onReply={onReply} />
            </div>
          </div>

          <div className="mx-auto flex w-full max-w-[46rem] flex-col gap-2 px-8 pt-2 pb-4">
            {finished && !teaching && (
              <p className="text-center font-mono text-xs text-muted">
                Lesson complete —{" "}
                <Link href="/practice" className="text-accent underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-accent">
                  practice it later
                </Link>
              </p>
            )}
            <ErrorBanner error={chat.error} onRetry={() => chat.retry && send(chat.retry)} />
            <Composer streaming={chat.streaming} onSend={(text) => send({ text, checkId: null })} onStop={chat.stop} seed={seed} />
          </div>
        </div>
        {planOpen && (
          <PlanPanel
            lesson={lesson}
            statusOf={(i) => topicStatus(i, current, new Set(anchors.keys()), finished)}
            opened={(i) => anchors.has(i)}
            onJump={(i) => document.getElementById(`topic-${i}`)?.scrollIntoView({ block: "start", behavior: "smooth" })}
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
