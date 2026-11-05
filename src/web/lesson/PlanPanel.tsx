import type { JSX } from "react";
import type { LessonDetail } from "../../shared/api.ts";
import { DeleteLessonButton } from "../components/DeleteLessonButton.tsx";
import type { StepStatus } from "./transcript.ts";

const DOT: Record<StepStatus, string> = {
  done: "bg-accent border-accent",
  current: "border-accent",
  todo: "border-border",
};
const SAY: Record<StepStatus, string> = { done: "done", current: "current", todo: "not started" };

// O(n) in planned steps
// INV: only opened steps are clickable; clicking scrolls the transcript to that step
export function PlanPanel({ lesson, statusOf, opened, onJump, onDeleted }: { lesson: LessonDetail; statusOf: (i: number) => StepStatus; opened: (i: number) => boolean; onJump: (i: number) => void; onDeleted: () => void }): JSX.Element {
  return (
    <aside id="lesson-plan" aria-label="Lesson plan" className="scroll-quiet flex w-72 shrink-0 flex-col gap-6 overflow-y-auto border-l border-border px-5 py-5">
      <section className="flex flex-col gap-2">
        <h2 className="label">Plan</h2>
        <ol className="flex flex-col">
          {lesson.plan.steps.map((s, i) => {
            const st = statusOf(i);
            return (
              <li key={`${i}-${s.title}`}>
                <button
                  type="button"
                  disabled={!opened(i)}
                  aria-current={st === "current" ? "step" : undefined}
                  onClick={() => onJump(i)}
                  className="flex w-full items-start gap-3 rounded-lg px-2 py-2 text-left text-sm transition hover:bg-panel-2 focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-default disabled:hover:bg-transparent"
                >
                  <span aria-hidden="true" className={`mt-1.5 size-2 shrink-0 rounded-full border ${DOT[st]}`} />
                  <span className="flex min-w-0 flex-col">
                    <span className={st === "todo" ? "text-muted" : "text-text"}>
                      {i + 1}. {s.title}
                    </span>
                    <span className="sr-only">, {SAY[st]}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </section>
      {lesson.prerequisites.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="label">Before you start</h2>
          <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-muted">
            {lesson.prerequisites.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </section>
      )}
      <div className="mt-auto flex justify-end">
        <DeleteLessonButton lessonId={lesson.id} lessonTitle={lesson.title} onDeleted={onDeleted} />
      </div>
    </aside>
  );
}
