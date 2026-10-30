import { useEffect, useState, type JSX } from "react";
import { Link } from "wouter";
import { z } from "zod";
import { LessonSummary } from "../../shared/api.ts";
import { api } from "../api.ts";
import { AskBar } from "../components/AskBar.tsx";
import { DeleteLessonButton } from "../components/DeleteLessonButton.tsx";
import { ErrorBanner } from "../components/ErrorBanner.tsx";
import { Panel } from "../components/Panel.tsx";
import { Spinner } from "../components/Spinner.tsx";

// O(n) in lessons
export function TeachPage(): JSX.Element {
  const [lessons, setLessons] = useState<LessonSummary[] | null>(null);
  const [error, setError] = useState<unknown>(null);
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
      </Panel>
      <Panel>
        <h2 className="mb-3 text-lg font-semibold">Recent lessons</h2>
        <ErrorBanner error={error} />
        {lessons === null && !error && <Spinner label="Loading" />}
        {lessons?.length === 0 && <p className="text-sm text-muted">No lessons yet. Your first one will show up here.</p>}
        <ul className="grid gap-2 sm:grid-cols-2">
          {lessons?.map((l) => (
            <li key={l.id} className="flex flex-col gap-3 rounded-xl border border-border bg-panel-2 px-4 py-3">
              <Link href={`/lesson/${l.id}`} className="flex flex-col transition hover:text-accent">
                <span className="font-medium">{l.title}</span>
                <span className="text-xs text-muted">{new Date(l.createdAt).toLocaleDateString()}</span>
              </Link>
              <DeleteLessonButton lessonId={l.id} lessonTitle={l.title} onDeleted={() => setLessons((rows) => rows?.filter((row) => row.id !== l.id) ?? rows)} />
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
