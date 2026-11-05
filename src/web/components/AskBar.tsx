import { useEffect, useState, type JSX } from "react";
import { useLocation } from "wouter";
import { GenerateResponse, LessonCreated, ModelsResponse } from "../../shared/api.ts";
import { beginAskJob, failAskJob, finishAskJob, getAskJob, useAskJob } from "../askJob.ts";
import { api } from "../api.ts";
import { useSettings } from "../session.tsx";
import { AttachSources, type Attachments } from "./AttachSources.tsx";
import { Button } from "./Button.tsx";
import { ErrorBanner } from "./ErrorBanner.tsx";

// O(n) in attachments
// INV: plain JSON without attachments; multipart with prompt, model, url and file fields otherwise
function lessonBody(prompt: string, model: string, a: Attachments): FormData | { prompt: string; model?: string } {
  if (a.files.length === 0 && a.urls.length === 0) return { prompt, ...(model ? { model } : {}) };
  const form = new FormData();
  form.set("prompt", prompt);
  if (model) form.set("model", model);
  for (const u of a.urls) form.append("url", u);
  for (const f of a.files) form.append("file", f, f.name);
  return form;
}

// O(1)
// INV: an in-flight teach request stays in askJob across unmount, so returning to /teach still shows that lesson
export function AskBar(): JSX.Element {
  const { settings } = useSettings();
  const [, navigate] = useLocation();
  const job = useAskJob();
  const [text, setText] = useState(() => getAskJob()?.text ?? "");
  const [models, setModels] = useState<ModelsResponse>([]);
  const [model, setModel] = useState(() => getAskJob()?.model ?? settings.model ?? "");
  const [attached, setAttached] = useState<Attachments>({ files: [], urls: [] });
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
        const r = await api("/api/lessons", LessonCreated, { method: "POST", body: lessonBody(topic, chosen, attached) });
        finishAskJob(id);
        setAttached({ files: [], urls: [] });
        window.dispatchEvent(new Event("btg:lessons-changed"));
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

  const submit = (mode: "teach" | "practice"): void => {
    void run(mode);
  };
  const disabled = topic.length < 2 || busy !== null;
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        submit("teach");
      }}
    >
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-panel p-3 focus-within:border-accent">
        <textarea
          className="scroll-quiet max-h-60 min-h-20 w-full resize-none bg-transparent px-1 text-base text-text outline-none placeholder:text-muted"
          placeholder="Describe a topic, a question, or a paper…"
          aria-label="What do you want to learn?"
          maxLength={2000}
          rows={3}
          value={text}
          disabled={busy !== null}
          onChange={(e) => setText(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              if (!disabled) submit("teach");
            }
          }}
        />
        <AttachSources value={attached} onChange={setAttached} disabled={busy !== null} />
        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
          <select className="max-w-48 truncate rounded-full border border-border bg-bg px-2.5 py-1 font-mono text-xs text-muted outline-none focus:border-accent" aria-label="Model" value={chosen} disabled={busy !== null} onChange={(e) => setModel(e.currentTarget.value)}>
            {models.map((m) => (
              <option key={`${m.provider}:${m.id}`} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
          <span className="ml-auto" />
          <Button variant="soft" busy={busy === "practice"} disabled={disabled} onClick={() => submit("practice")}>
            Practice set
          </Button>
          <Button type="submit" busy={busy === "teach"} disabled={disabled}>
            Start
          </Button>
        </div>
      </div>
      {busy && <p className="font-mono text-xs text-muted">{busy === "teach" ? `${attached.files.length + attached.urls.length > 0 ? "Reading your attachments, finding papers" : "Finding papers"} and planning "${job?.text ?? text}"…` : "Writing practice questions…"}</p>}
      <ErrorBanner error={error} onRetry={() => submit(job?.mode ?? "teach")} />
    </form>
  );
}
