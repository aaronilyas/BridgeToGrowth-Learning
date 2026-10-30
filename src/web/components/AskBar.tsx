import { useEffect, useState, type JSX } from "react";
import { useLocation } from "wouter";
import { GenerateResponse, LessonCreated, ModelsResponse } from "../../shared/api.ts";
import { api } from "../api.ts";
import { useSettings } from "../session.tsx";
import { Button } from "./Button.tsx";
import { ErrorBanner } from "./ErrorBanner.tsx";

// O(1)
export function AskBar(): JSX.Element {
  const { settings } = useSettings();
  const [, navigate] = useLocation();
  const [text, setText] = useState("");
  const [models, setModels] = useState<ModelsResponse>([]);
  const [model, setModel] = useState(settings.model ?? "");
  const [busy, setBusy] = useState<"teach" | "practice" | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [last, setLast] = useState<"teach" | "practice">("teach");

  useEffect(() => {
    let live = true;
    api("/api/models", ModelsResponse).then((m) => live && setModels(m), () => undefined);
    return () => {
      live = false;
    };
  }, []);

  const chosen = models.some((m) => m.id === model) ? model : "";
  const topic = text.trim();

  const run = async (mode: "teach" | "practice"): Promise<void> => {
    if (topic.length < 2 || busy) return;
    setBusy(mode);
    setLast(mode);
    setError(null);
    try {
      if (mode === "teach") {
        const r = await api("/api/lessons", LessonCreated, { method: "POST", body: { prompt: topic, ...(chosen ? { model: chosen } : {}) } });
        navigate(`/lesson/${r.lessonId}`);
      } else {
        await api("/api/questions/generate", GenerateResponse, { method: "POST", body: { topic, count: settings.bite.questionsPerSession, ...(chosen ? { model: chosen } : {}) } });
        navigate("/practice");
      }
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
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
          onChange={(e) => setText(e.currentTarget.value)}
        />
        <select className="rounded-xl border border-border bg-panel-2 px-3 py-3 text-sm outline-none focus:border-accent" aria-label="Model" value={chosen} onChange={(e) => setModel(e.currentTarget.value)}>
          <option value="">Default model</option>
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
      {busy && <p className="text-sm text-muted">{busy === "teach" ? "Finding papers and planning your lesson…" : "Writing practice questions…"}</p>}
      <ErrorBanner error={error} onRetry={() => void run(last)} />
    </form>
  );
}
