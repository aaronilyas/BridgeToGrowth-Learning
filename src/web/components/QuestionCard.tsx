import { useEffect, useRef, useState, type JSX, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { AttemptResponse, type QuestionCategory, type QuestionPublic, type StepAttempt } from "../../shared/api.ts";
import type { CodeAttempt } from "../../shared/code.ts";
import { api } from "../api.ts";
import type { SentAttempt } from "../lesson/transcript.ts";
import { runPython } from "../pyodide/runner.ts";
import { useSettings } from "../session.tsx";
import { Button } from "./Button.tsx";
import { CodeExercise, TestResults } from "./CodeExercise.tsx";
import { ConfidenceSlider } from "./ConfidenceSlider.tsx";
import { ErrorBanner } from "./ErrorBanner.tsx";
import { Md } from "./Md.tsx";
import { Sources } from "./Sources.tsx";

export type { SentAttempt } from "../lesson/transcript.ts";

const DAY_MS = 86_400_000;
const CAPTION: Record<QuestionCategory, string> = { terminology: "Terminology", conceptual: "Prediction", mcq: "Multiple choice", free: "Free response" };

// O(1)
export function captionOf(q: Pick<QuestionPublic, "kind" | "category">): string {
  if (q.kind === "code") return "Code";
  if (q.category) return CAPTION[q.category];
  return q.kind === "mcq" ? "Multiple choice" : "Free response";
}

// O(1)
function reviewIn(nextDueAt: string | null, now: number): string | null {
  if (nextDueAt === null) return null;
  const days = Math.max(0, Math.round((Date.parse(nextDueAt) - now) / DAY_MS));
  return days === 0 ? "Next review today" : `Next review in ${days} day${days === 1 ? "" : "s"}`;
}

// O(1)
export function answeredLine(a: StepAttempt): string {
  if (a.dontKnow) return "Answered · didn't know";
  return `Answered · ${a.correct ? "correct" : "incorrect"}${a.confidence === null ? "" : ` · ${a.confidence}% confident`}`;
}

// O(1)
// INV: Enter submits, Shift+Enter keeps the newline
function enterSubmits(e: ReactKeyboardEvent<HTMLTextAreaElement>, submit: () => void): void {
  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
    e.preventDefault();
    submit();
  }
}

// O(c) in choices
// INV: until `result` exists nothing here knows the answer; afterwards it shows exactly what the attempt response returned
// INV: mount the card with key={question.id}; latency runs from mount to submit
// INV: `answered` (a saved attempt) renders the compact answered state and accepts no new attempt
export function QuestionCard({ question, onResult, label = "Check", answered = null }: { question: QuestionPublic; onResult?: (r: AttemptResponse, sent: SentAttempt) => void; label?: string; answered?: StepAttempt | null }): JSX.Element {
  const { settings } = useSettings();
  const askConfidence = settings.recall.confidencePrompt;
  const started = useRef(performance.now());
  const [choice, setChoice] = useState<number | null>(null);
  const [dontKnow, setDontKnow] = useState(false);
  const [text, setText] = useState(question.code?.starter ?? "");
  const [thinking, setThinking] = useState("");
  const [confidence, setConfidence] = useState(50);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [note, setNote] = useState<string | null>(null);
  const [result, setResult] = useState<{ r: AttemptResponse; sent: SentAttempt } | null>(null);
  const isMcq = question.kind === "mcq" && question.choices !== null;
  const code = question.kind === "code" ? question.code : null;
  const locked = result !== null || answered !== null;
  const ready = dontKnow || (isMcq ? choice !== null : text.trim() !== "");

  const pick = (i: number | null): void => {
    setChoice(i);
    setDontKnow(i === null);
  };

  // O(tests) for code, O(1) otherwise
  // SEC: "I don't know" sends no choice, response or code run, so nothing is graded and confidence is 0
  const submit = async (skip = dontKnow): Promise<void> => {
    if (busy || locked || !(skip || ready)) return;
    setBusy(true);
    setError(null);
    setNote(null);
    const response = isMcq ? thinking.trim() : code ? text : text.trim();
    const latencyMs = Math.min(3_600_000, Math.round(performance.now() - started.current));
    try {
      let body: Record<string, unknown>;
      if (skip) body = { questionId: question.id, dontKnow: true, confidence: 0, latencyMs };
      else {
        let codeRun: CodeAttempt | null = null;
        if (code) {
          const ran = await runPython(code, text, { tests: question.codeTests ?? [] });
          if (!ran.started) {
            setNote(ran.error ?? "Python failed to start.");
            return;
          }
          codeRun = { tests: ran.tests, error: ran.error };
        }
        body = {
          questionId: question.id,
          ...(isMcq && choice !== null ? { choice } : {}),
          ...(response === "" ? {} : { response }),
          ...(codeRun ? { codeRun } : {}),
          confidence,
          latencyMs,
        };
      }
      const r = await api("/api/practice/attempt", AttemptResponse, { method: "POST", body });
      const sent: SentAttempt = {
        kind: question.kind,
        choiceText: isMcq && choice !== null && !skip ? (question.choices?.[choice] ?? null) : null,
        response: skip ? "" : isMcq ? "" : response,
        thinking: skip ? "" : isMcq ? response : "",
        confidence: skip || !askConfidence ? null : confidence,
        dontKnow: skip,
      };
      setResult({ r, sent });
      onResult?.(r, sent);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  const submitRef = useRef(submit);
  submitRef.current = submit;

  useEffect(() => {
    if (!isMcq || locked) return;
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target;
      const typing = t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement || (t instanceof HTMLInputElement && t.type !== "radio");
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      const i = ["1", "2", "3", "4"].indexOf(e.key);
      if (i >= 0 && i < (question.choices?.length ?? 0)) {
        setChoice(i);
        setDontKnow(false);
      } else if (e.key === "Enter" && !(t instanceof HTMLButtonElement) && !(t instanceof HTMLAnchorElement)) void submitRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isMcq, locked, question.choices?.length]);

  // INV: rows are positioned so each sr-only radio stays inside its row; otherwise focusing it scrolls the app shell and blanks the lesson
  const row = "relative flex cursor-pointer items-start gap-3 rounded-xl border px-4 py-3 text-sm transition has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-accent";

  return (
    <section aria-label={label} className="rounded-2xl border border-border bg-panel">
      <div className="flex flex-col gap-3 p-5">
        <p className="label">{captionOf(question)}</p>
        <Md text={question.stem} className="[&>p:first-child]:mt-0" />
        {!locked && isMcq && (
          <fieldset className="flex flex-col gap-2">
            <legend className="sr-only">Choices (keys 1 to {question.choices?.length})</legend>
            {question.choices?.map((c, i) => {
              const on = choice === i;
              return (
                <label key={`${i}-${c}`} className={`${row} ${on ? "border-accent/60 bg-accent-soft" : "border-border hover:bg-panel-2"}`}>
                  <input type="radio" className="sr-only" name={`q-${question.id}`} checked={on} onChange={() => pick(i)} />
                  <Dot on={on} />
                  <Md text={c} className="min-w-0 flex-1 [&_p]:my-0" />
                </label>
              );
            })}
            <label className={`${row} border-dashed ${dontKnow ? "border-muted bg-panel-2" : "border-border hover:bg-panel-2"}`}>
              <input type="radio" className="sr-only" name={`q-${question.id}`} checked={dontKnow} onChange={() => pick(null)} />
              <Dot on={dontKnow} />
              <span className="font-mono text-muted">I don't know</span>
            </label>
          </fieldset>
        )}
        {!locked && code && <CodeExercise spec={code} value={text} onChange={setText} disabled={busy} />}
        {answered && !result && <p className="font-mono text-xs uppercase tracking-wider text-muted">{answeredLine(answered)}</p>}
        {result && <Result r={result.r} sent={result.sent} choices={question.choices} />}
      </div>

      {!locked && (
        <>
          {askConfidence && (
            <div className="border-t border-border px-5 py-3">
              <ConfidenceSlider value={dontKnow ? 0 : confidence} onChange={setConfidence} disabled={dontKnow} />
            </div>
          )}
          <div className="m-2 flex flex-col gap-2 rounded-xl border border-border bg-bg/40 p-3">
            {!code && (
              <label className="flex flex-col gap-2">
                <span className="label">{isMcq ? "Your thinking" : "Your answer"}</span>
                <textarea
                  className="min-h-20 w-full resize-none bg-transparent text-sm leading-relaxed outline-none placeholder:text-muted/70"
                  placeholder={isMcq ? "Why this answer? Whatever comes to mind." : "Write your answer…"}
                  maxLength={5000}
                  value={isMcq ? thinking : text}
                  onChange={(e) => (isMcq ? setThinking : setText)(e.currentTarget.value)}
                  onKeyDown={(e) => enterSubmits(e, () => void submit())}
                />
              </label>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-mono text-xs text-muted">{code ? "submit runs the hidden tests" : isMcq ? "1–4 picks · ↵ submits · ⇧↵ newline" : "↵ submits · ⇧↵ newline"}</span>
              {!isMcq && (
                <button type="button" disabled={busy} onClick={() => void submit(true)} className="font-mono text-xs text-muted underline-offset-4 hover:text-text hover:underline focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50">
                  I don't know
                </button>
              )}
              <Button busy={busy} disabled={!ready} onClick={() => void submit()} className="ml-auto">
                Submit answer
              </Button>
            </div>
          </div>
        </>
      )}
      {(note || error !== null) && (
        <div className="flex flex-col gap-2 px-5 pb-4">
          {note && <div role="alert" className="rounded-lg border border-danger/50 px-3 py-2 text-sm text-danger">{note}</div>}
          <ErrorBanner error={error} onRetry={() => void submit()} />
        </div>
      )}
    </section>
  );
}

// O(1)
function Dot({ on }: { on: boolean }): JSX.Element {
  return (
    <span aria-hidden="true" className={`mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border ${on ? "border-accent" : "border-muted/60"}`}>
      {on && <span className="size-2 rounded-full bg-accent" />}
    </span>
  );
}

// O(n) in result size
function Result({ r, sent, choices }: { r: AttemptResponse; sent: SentAttempt; choices: string[] | null }): JSX.Element {
  const right = r.answer.kind === "mcq" && !r.correct ? (choices?.[r.answer.index] ?? null) : null;
  const next = reviewIn(r.nextDueAt, Date.now());
  const verdict = sent.dontKnow ? "Didn't know" : r.correct ? "Correct" : "Incorrect";
  const tone = sent.dontKnow ? "text-muted" : r.correct ? "text-accent" : "text-danger";
  return (
    <div role="status" className="flex flex-col gap-2 text-sm">
      {sent.choiceText !== null && (
        <div className="flex items-start gap-2 text-muted">
          <span className="label pt-0.5">You chose</span>
          <Md text={sent.choiceText} className="min-w-0 flex-1 text-text [&_p]:my-0" />
        </div>
      )}
      {right !== null && (
        <div className="flex items-start gap-2 text-muted">
          <span className="label pt-0.5">Answer</span>
          <Md text={right} className="min-w-0 flex-1 text-text [&_p]:my-0" />
        </div>
      )}
      <p className={`font-mono text-xs uppercase tracking-wider ${tone}`}>
        {verdict}
        {sent.confidence !== null && ` · ${sent.confidence}% confident`}
      </p>
      {r.feedback && <p>{r.feedback}</p>}
      {r.answer.kind === "code" && <TestResults tests={r.answer.tests} model={r.answer.model} />}
      {r.answer.kind === "free" && (
        <div>
          <p className="label">Model answer</p>
          <Md text={r.answer.model} />
        </div>
      )}
      {r.explanation !== "" && <Md text={r.explanation} className="text-muted" />}
      <Sources citations={r.citations} />
      {next && <p className="font-mono text-xs text-muted">{next}</p>}
    </div>
  );
}
