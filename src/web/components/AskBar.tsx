import { useEffect, useState, type JSX } from "react";
import { useLocation } from "wouter";
import { GenerateResponse, LessonCreated, ModelsResponse } from "../../shared/api.ts";
import { beginAskJob, failAskJob, finishAskJob, getAskJob, useAskJob } from "../askJob.ts";
import { api } from "../api.ts";
import { useSettings } from "../session.tsx";
import { Button } from "./Button.tsx";
import { ErrorBanner } from "./ErrorBanner.tsx";

// O(1)
// INV: an in-flight teach request stays in askJob across unmount, so returning to /teach still shows that lesson
export function AskBar(): JSX.Element {
  const { settings } = useSettings();
  const [, navigate] = useLocation();
  const job = useAskJob();
  const [text, setText] = useState(() => getAskJob()?.text ?? "");
  const [models, setModels] = useState<ModelsResponse>([]);
  const [model, setModel] = useState(() => getAskJob()?.model ?? settings.model ?? "");
  const busy = job?.phase === "running" ? job.mode : null;
  const error = job?.phase === "error" ? job.error : null;

  useEffect(() => {
    let live = true;
    api("/api/models", ModelsResponse).then((m) => live && setModels(m), () => undefined);
    return () => {
      live = false;
    };
  }, []);

  const chosen = models.some((m) => m.id === model) ? model : models.find((m) => m.id === settings.model)?.id ?? models[0]?.id ?? "";
  const topic = text.trim();

  const run = async (mode: "teach" | "practice"): Promise<void> => {
    if (topic.length < 2 || getAskJob()?.phase === "running") return;
    const id = beginAskJob({ mode, text: topic, model: chosen });
    if (id === null) return;
    try {
      if (mode === "teach") {
        const r = await api("/api/lessons", LessonCreated, { method: "POST", body: { prompt: topic, ...(chosen ? { model: chosen } : {}) } });
        finishAskJob(id);
        navigate(`/lesson/${r.lessonId}`);
      } else {
        await api("/api/questions/generate", GenerateResponse, { method: "POST", body: { topic, ...(chosen ? { model: chosen } : {}) } });
        finishAskJob(id);
        navigate("/practice");
      }
    } catch (e) {
      failAskJob(id, e);
    }
  };

  return (
    <form
      className="flex flex-col gap-3 rounded-2xl border border-border bg-panel p-4"
      onSubmit={(e) => {
        e.preventDefault();
        void run("teach");
      }}
    >
      <div className="flex flex-wrap items-center gap-3">
        <input
          className="min-w-64 flex-1 rounded-xl border border-border bg-panel-2 px-4 py-3 text-base outline-none focus:border-accent"
          placeholder="What do you want to learn?"
          aria-label="What do you want to learn?"
          maxLength={2000}
          value={text}
          disabled={busy !== null}
          onChange={(e) => setText(e.currentTarget.value)}
        />
        <select className="rounded-xl border border-border bg-panel-2 px-3 py-3 text-sm outline-none focus:border-accent" aria-label="Model" value={chosen} disabled={busy !== null} onChange={(e) => setModel(e.currentTarget.value)}>
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
        <Button type="submit" busy={busy === "teach"} disabled={topic.length < 2 || busy !== null}>
          Teach
        </Button>
        <Button variant="soft" busy={busy === "practice"} disabled={topic.length < 2 || busy !== null} onClick={() => void run("practice")}>
          Practice
        </Button>
      </div>
      {busy && <p className="text-sm text-muted">{busy === "teach" ? `Finding papers and planning "${job?.text ?? text}"…` : "Writing practice questions…"}</p>}
      <ErrorBanner error={error} onRetry={() => void run(job?.mode ?? "teach")} />
    </form>
  );
}
