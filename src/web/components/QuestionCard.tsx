import { useEffect, useRef, useState, type JSX } from "react";
import { AttemptResponse, type QuestionCategory, type QuestionPublic } from "../../shared/api.ts";
import { api } from "../api.ts";
import { useSettings } from "../session.tsx";
import { Button } from "./Button.tsx";
import { CodeExercise, TestResults } from "./CodeExercise.tsx";
import { ConfidenceSlider } from "./ConfidenceSlider.tsx";
import { ErrorBanner } from "./ErrorBanner.tsx";
import { Md } from "./Md.tsx";
import { Sources } from "./Sources.tsx";

const LETTERS = ["A", "B", "C", "D"];
const DAY_MS = 86_400_000;
const CATEGORY_LABEL: Record<QuestionCategory, string> = { terminology: "Terminology", conceptual: "Conceptual", mcq: "Multiple choice", free: "Free response" };
const CODE_LABEL = "Code exercise";

// O(1)
function reviewIn(nextDueAt: string | null, now: number): string | null {
  if (nextDueAt === null) return null;
  const days = Math.max(0, Math.round((Date.parse(nextDueAt) - now) / DAY_MS));
  return days === 0 ? "Next review: today" : `Next review in ${days} day${days === 1 ? "" : "s"}`;
}

// O(c) in choices
// INV: until `result` exists nothing here knows the answer; afterwards it shows exactly what the attempt response returned
// INV: mount the card with key={question.id}; latency runs from mount to submit
export function QuestionCard({ question, onResult, label = "Quick Check" }: { question: QuestionPublic; onResult?: (r: AttemptResponse) => void; label?: string }): JSX.Element {
  const { settings } = useSettings();
  const started = useRef(performance.now());
  const [choice, setChoice] = useState<number | null>(null);
  const [text, setText] = useState(question.code?.starter ?? "");
  const [thinking, setThinking] = useState("");
  const [confidence, setConfidence] = useState(50);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [result, setResult] = useState<AttemptResponse | null>(null);
  const isMcq = question.kind === "mcq" && question.choices !== null;
  const code = question.kind === "code" ? question.code : null;
  const ready = isMcq ? choice !== null : text.trim() !== "";

  const submit = async (): Promise<void> => {
    if (busy || result || !ready) return;
    setBusy(true);
    setError(null);
    const response = isMcq ? thinking.trim() : code ? text : text.trim();
    try {
      const r = await api("/api/practice/attempt", AttemptResponse, {
        method: "POST",
        body: {
          questionId: question.id,
          ...(isMcq && choice !== null ? { choice } : {}),
          ...(response === "" ? {} : { response }),
          confidence,
          latencyMs: Math.min(3_600_000, Math.round(performance.now() - started.current)),
        },
      });
      setResult(r);
      onResult?.(r);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  const submitRef = useRef(submit);
  submitRef.current = submit;

  useEffect(() => {
    if (!isMcq || result) return;
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target;
      const typing = t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement || (t instanceof HTMLInputElement && t.type !== "radio");
      if (typing) return;
      const i = ["1", "2", "3", "4"].indexOf(e.key);
      if (i >= 0 && i < (question.choices?.length ?? 0)) setChoice(i);
      else if (e.key === "Enter" && !(t instanceof HTMLButtonElement)) void submitRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isMcq, result, question.choices?.length]);

  const correctIdx = result?.answer.kind === "mcq" ? result.answer.index : null;
  const next = result ? reviewIn(result.nextDueAt, Date.now()) : null;

  return (
    <section aria-label={label} className="rounded-2xl border border-border bg-panel p-5">
      <h3 className="mb-2 flex items-center gap-2 text-lg font-semibold text-accent">
        {label}
        {question.category && <span className="rounded-full bg-accent-soft px-2.5 py-0.5 text-xs font-medium">{code ? CODE_LABEL : CATEGORY_LABEL[question.category]}</span>}
      </h3>
      <Md text={question.stem} />
      {isMcq ? (
        <fieldset className="mt-3 flex flex-col gap-2" disabled={result !== null}>
          <legend className="sr-only">Choices</legend>
          {question.choices?.map((c, i) => {
            const state = result ? (i === correctIdx ? "border-accent bg-accent-soft" : i === choice ? "border-danger/60" : "border-border") : i === choice ? "border-accent bg-accent-soft" : "border-border hover:bg-panel-2";
            return (
              <label key={`${i}-${c}`} className={`flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 text-sm ${state}`}>
                <input type="radio" name={`q-${question.id}`} checked={choice === i} onChange={() => setChoice(i)} />
                <span className="font-semibold text-accent">{LETTERS[i]}</span>
                <Md text={c} className="min-w-0 flex-1 [&_p]:my-0" />
                <kbd className="text-xs text-muted">{i + 1}</kbd>
              </label>
            );
          })}
        </fieldset>
      ) : code ? (
        <CodeExercise questionId={question.id} spec={code} value={text} onChange={setText} disabled={result !== null} />
      ) : (
        <textarea
          className="mt-3 min-h-28 w-full rounded-xl border border-border bg-panel-2 p-3 text-sm outline-none focus:border-accent"
          placeholder="Write your answer…"
          aria-label="Your answer"
          maxLength={5000}
          value={text}
          disabled={result !== null}
          onChange={(e) => setText(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void submit();
            }
          }}
        />
      )}
      {!result && (
        <div className="mt-4 flex flex-col gap-3 border-t border-border pt-4">
          {settings.recall.confidencePrompt && <ConfidenceSlider value={confidence} onChange={setConfidence} />}
          <div className="flex flex-wrap items-center gap-3">
            {isMcq && (
              <label className="flex min-w-48 flex-1 items-center gap-2 text-sm">
                <span className="shrink-0 text-muted">Your thinking</span>
                <input
                  className="w-full rounded-xl border border-border bg-panel-2 px-3 py-2.5 text-sm outline-none focus:border-accent"
                  placeholder="Explain your choice in a sentence…"
                  maxLength={5000}
                  value={thinking}
                  onChange={(e) => setThinking(e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void submit();
                  }}
                />
              </label>
            )}
            <Button busy={busy} disabled={!ready} onClick={() => void submit()} className="ml-auto">
              Submit Answer →
            </Button>
          </div>
        </div>
      )}
      <div className="mt-3">
        <ErrorBanner error={error} onRetry={() => void submit()} />
      </div>
      {result && (
        <div role="status" className={`mt-4 rounded-xl border p-4 text-sm ${result.correct ? "border-accent/50 bg-accent-soft" : "border-danger/50 bg-panel-2"}`}>
          <p className={`font-semibold ${result.correct ? "text-accent" : "text-danger"}`}>
            {result.correct ? "Correct" : "Incorrect"} · score {Math.round(result.score * 100)}%
          </p>
          {result.feedback && <p className="mt-1">{result.feedback}</p>}
          {result.answer.kind === "code" && <TestResults tests={result.answer.tests} model={result.answer.model} />}
          {result.answer.kind === "free" && (
            <div className="mt-2">
              <p className="text-muted">Model answer</p>
              <Md text={result.answer.model} />
            </div>
          )}
          <Md text={result.explanation} className="mt-2" />
          <div className="mt-2">
            <Sources citations={result.citations} />
          </div>
          {next && <p className="mt-2 text-muted">{next}</p>}
        </div>
      )}
    </section>
  );
}
