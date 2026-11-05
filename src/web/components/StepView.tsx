import { memo, type JSX } from "react";
import type { AttemptResponse, StepPublic } from "../../shared/api.ts";
import type { SentAttempt } from "../lesson/transcript.ts";
import { Md } from "./Md.tsx";
import { QuestionCard } from "./QuestionCard.tsx";
import { Sources } from "./Sources.tsx";

// O(1)
export function StepSkeleton(): JSX.Element {
  return (
    <div className="flex animate-pulse flex-col gap-3 motion-reduce:animate-none" aria-busy="true" aria-label="Generating this step">
      <div className="h-3 w-40 rounded bg-panel-2" />
      <div className="h-4 w-full rounded bg-panel-2" />
      <div className="h-4 w-11/12 rounded bg-panel-2" />
      <div className="h-4 w-3/4 rounded bg-panel-2" />
      <div className="mt-3 h-12 rounded-lg border border-border" />
    </div>
  );
}

// O(1)
// INV: the callout leads with a bold label unless the model already wrote one
function keyIdeaMd(text: string): string {
  return text.trimStart().startsWith("**") ? text : `**Key idea:** ${text}`;
}

// O(n) in step size
// INV: memoised, so a streaming chat turn does not re-render (and re-typeset) earlier steps; pass a stable onResult
export const StepView = memo(function StepView({ step, total, onResult }: { step: StepPublic; total: number; onResult: (idx: number, r: AttemptResponse, sent: SentAttempt) => void }): JSX.Element {
  return (
    <article id={`step-${step.idx}`} aria-labelledby={`step-${step.idx}-h`} className="flex scroll-mt-6 flex-col gap-5">
      <h2 id={`step-${step.idx}-h`} className="label">
        Step {step.idx + 1} / {total} · {step.title}
      </h2>
      <Md text={step.explanationMd} className="[&>p:first-child]:mt-0" />
      <aside aria-label="Key idea" className="border border-border px-5 py-3">
        <Md text={keyIdeaMd(step.keyIdea)} className="[&_p]:my-0" />
      </aside>
      {step.example && (
        <section aria-label="Example" className="flex flex-col gap-1">
          <p className="label">Example</p>
          <Md text={step.example} className="[&>p:first-child]:mt-0" />
        </section>
      )}
      <div className="mx-auto w-full max-w-[44rem]">
        <QuestionCard key={step.check.id} question={step.check} label={`Check for step ${step.idx + 1}`} answered={step.lastAttempt} onResult={(r, sent) => onResult(step.idx, r, sent)} />
      </div>
      <Sources citations={step.citations} />
    </article>
  );
});
