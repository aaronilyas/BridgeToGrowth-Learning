import type { JSX } from "react";
import type { AttemptResponse, StepPublic } from "../../shared/api.ts";
import { Md } from "./Md.tsx";
import { QuestionCard } from "./QuestionCard.tsx";
import { Sources } from "./Sources.tsx";

// O(1)
export function StepSkeleton(): JSX.Element {
  return (
    <div className="flex animate-pulse flex-col gap-4" aria-busy="true" aria-label="Generating this step">
      <div className="h-4 w-24 rounded bg-panel-2" />
      <div className="h-9 w-2/3 rounded bg-panel-2" />
      <div className="h-24 rounded-xl bg-panel-2" />
      <div className="h-20 rounded-xl bg-accent-soft" />
      <div className="h-48 rounded-2xl bg-panel-2" />
    </div>
  );
}

// O(n) in step size
export function StepView({ step, total, summary, onResult }: { step: StepPublic; total: number; summary: string; onResult: (r: AttemptResponse) => void }): JSX.Element {
  return (
    <article className="flex flex-col gap-5">
      <header className="flex flex-col gap-1 border-b border-border pb-4">
        <p className="text-sm font-medium text-accent">
          Lesson {step.idx + 1} of {total}
        </p>
        <h1 className="text-3xl font-semibold">{step.title}</h1>
        <p className="text-muted">{summary}</p>
      </header>
      <Md text={step.explanationMd} />
      <aside className="rounded-xl bg-accent-soft p-4" aria-label="Key idea">
        <p className="font-semibold text-accent">Key Idea</p>
        <Md text={step.keyIdea} />
      </aside>
      {step.example && (
        <section aria-label="Example" className="rounded-xl border border-border bg-panel-2 p-4">
          <p className="font-semibold text-accent-2">Example</p>
          <Md text={step.example} />
        </section>
      )}
      <QuestionCard key={step.check.id} question={step.check} onResult={onResult} />
      <Sources citations={step.citations} />
    </article>
  );
}
