import { useEffect, useState, type JSX } from "react";
import { Link } from "wouter";
import { z } from "zod";
import { LessonSummary } from "../../shared/api.ts";
import { generatingLessonPrompt, useAskJob } from "../askJob.ts";
import { api } from "../api.ts";
import { AskBar } from "../components/AskBar.tsx";
import { DeleteLessonButton } from "../components/DeleteLessonButton.tsx";
import { ErrorBanner } from "../components/ErrorBanner.tsx";
import { Panel } from "../components/Panel.tsx";
import { Spinner } from "../components/Spinner.tsx";
import { formatExpiry, useMinuteClock } from "../expiry.ts";
import { useIsPro, usePlanTerms } from "../session.tsx";

// O(1)
export function GeneratingLesson({ prompt }: { prompt: string }): JSX.Element {
  return (
    <li className="flex flex-col gap-2 rounded-xl border border-accent/40 bg-accent-soft px-4 py-3" aria-busy="true" aria-live="polite">
      <span className="font-medium">{prompt}</span>
      <Spinner size={14} label="Finding papers and planning your lesson…" />
    </li>
  );
}

// O(n) in lessons
// INV: a running teach request is listed before saved lessons, because it is not in /api/lessons until planning finishes
export function TeachPage(): JSX.Element {
  const [lessons, setLessons] = useState<LessonSummary[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const generating = generatingLessonPrompt(useAskJob());
  const pro = useIsPro();
  const terms = usePlanTerms();
  const now = useMinuteClock();
  useEffect(() => {
    let live = true;
    api("/api/lessons?limit=20", z.array(LessonSummary)).then((l) => live && setLessons(l), (e: unknown) => live && setError(e));
    return () => {
      live = false;
    };
  }, []);
  return (
    <div className="flex flex-col gap-4">
      <Panel className="flex flex-col gap-4">
        <h1 className="text-3xl font-semibold">What do you want to learn?</h1>
        <p className="text-muted">Ask for any topic. You'll get a short, source-grounded lesson with a check after every step.</p>
        <AskBar />
        {!pro && terms && (
          <p className="text-sm text-muted">
            On the Free plan, lessons are deleted {terms.free.lessonTtlDays} days after you create them.{" "}
            <Link href="/billing" className="font-medium text-accent hover:underline">
              Go Pro to keep them
            </Link>
            .
          </p>
        )}
      </Panel>
      <Panel>
        <h2 className="mb-3 text-lg font-semibold">Recent lessons</h2>
        <ErrorBanner error={error} />
        {lessons === null && !error && <Spinner label="Loading" />}
        {lessons?.length === 0 && !generating && <p className="text-sm text-muted">No lessons yet. Your first one will show up here.</p>}
        <ul className="grid gap-2 sm:grid-cols-2">
          {generating && <GeneratingLesson prompt={generating} />}
          {lessons?.map((l) => (
            <li key={l.id} className="flex flex-col gap-3 rounded-xl border border-border bg-panel-2 px-4 py-3">
              <Link href={`/lesson/${l.id}`} className="flex flex-col gap-1 transition hover:text-accent">
                <span className="font-medium">{l.title}</span>
                <span className="text-xs text-muted">{new Date(l.createdAt).toLocaleDateString()}</span>
                {l.expiresAt ? (
                  <span className="text-xs text-accent-2">
                    {formatExpiry(l.expiresAt, now)} · deletes {new Date(l.expiresAt).toLocaleString()}
                  </span>
                ) : (
                  <span className="text-xs text-muted">Kept</span>
                )}
              </Link>
              <DeleteLessonButton lessonId={l.id} lessonTitle={l.title} onDeleted={() => setLessons((rows) => rows?.filter((row) => row.id !== l.id) ?? rows)} />
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
