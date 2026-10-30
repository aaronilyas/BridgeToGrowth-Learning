import { memo, useCallback, useEffect, useRef, useState, type JSX } from "react";
import { MessageResponse, type Citation } from "../../shared/api.ts";
import { z } from "zod";
import { api, makeApiError } from "../api.ts";
import { streamSse } from "../sse.ts";
import { Button } from "./Button.tsx";
import { ErrorBanner } from "./ErrorBanner.tsx";
import { Md } from "./Md.tsx";
import { Sources } from "./Sources.tsx";

type Row = { id: string; role: "user" | "assistant"; content: string; citations: Citation[]; pending: boolean };

// O(n) in text length
// INV: streamed text may carry markers the server later strips; keep only [n] that the end event actually cites
function keepCited(text: string, cites: Citation[]): string {
  const ok = new Set(cites.map((c) => c.n));
  return text.replace(/\[(\d{1,9})\]/g, (m, d: string) => (ok.has(Number(d)) ? m : ""));
}

const MessageRow = memo(function MessageRow({ row }: { row: Row }): JSX.Element {
  const mine = row.role === "user";
  return (
    <li className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[92%] rounded-2xl border px-3 py-2 text-sm ${mine ? "border-accent/40 bg-accent-soft" : "border-border bg-panel-2"}`}>
        {row.pending && row.content === "" ? <span className="text-muted">Thinking…</span> : <Md text={row.content} />}
        {!mine && !row.pending && (
          <div className="mt-2">
            <Sources citations={row.citations} />
          </div>
        )}
      </div>
    </li>
  );
});

// O(m) per delta in the last row only
export function ChatPanel({ lessonId }: { lessonId: string }): JSX.Element {
  const [rows, setRows] = useState<Row[]>([]);
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const abort = useRef<AbortController | null>(null);
  const lastSent = useRef("");
  const list = useRef<HTMLUListElement>(null);

  useEffect(() => {
    let live = true;
    api(`/api/lessons/${lessonId}/messages`, z.array(MessageResponse)).then(
      (ms) => live && setRows([...ms].reverse().map((m) => ({ id: m.id, role: m.role, content: m.content, citations: m.citations, pending: false }))),
      (e: unknown) => live && setError(e),
    );
    return () => {
      live = false;
      abort.current?.abort();
    };
  }, [lessonId]);

  useEffect(() => {
    const el = list.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [rows]);

  const send = useCallback(async (message: string): Promise<void> => {
    const text = message.trim();
    if (text === "" || abort.current) return;
    lastSent.current = text;
    setError(null);
    setDraft("");
    setStreaming(true);
    const ctl = new AbortController();
    abort.current = ctl;
    const stamp = `${Date.now()}`;
    const aid = `a-${stamp}`;
    setRows((r) => [...r, { id: `u-${stamp}`, role: "user", content: text, citations: [], pending: false }, { id: aid, role: "assistant", content: "", citations: [], pending: true }]);
    const patch = (fn: (r: Row) => Row): void => setRows((rs) => rs.map((r) => (r.id === aid ? fn(r) : r)));
    try {
      await streamSse(`/api/lessons/${lessonId}/chat`, { message: text }, (e) => {
        if (e.t === "d") patch((r) => ({ ...r, content: r.content + e.v }));
        else if (e.t === "end") {
          const cites = e.citations ?? [];
          patch((r) => ({ ...r, content: keepCited(r.content, cites), citations: cites, pending: false }));
        } else throw makeApiError(0, e.code);
      }, ctl.signal);
      patch((r) => ({ ...r, pending: false }));
    } catch (e) {
      if (!ctl.signal.aborted) {
        setError(e);
        setDraft(text);
        setRows((rs) => rs.filter((r) => r.id !== aid && r.id !== `u-${stamp}`));
      } else patch((r) => ({ ...r, pending: false }));
    } finally {
      abort.current = null;
      setStreaming(false);
    }
  }, [lessonId]);

  return (
    <section aria-label="Follow-up chat" className="flex min-h-0 flex-1 flex-col gap-3">
      <h2 className="font-semibold">Ask a follow-up</h2>
      <ul ref={list} className="flex max-h-[28rem] min-h-40 flex-1 flex-col gap-2 overflow-y-auto pr-1" aria-live="polite">
        {rows.length === 0 && <li className="text-sm text-muted">Ask anything about this lesson. Answers cite peer-reviewed papers when they can.</li>}
        {rows.map((r) => (
          <MessageRow key={r.id} row={r} />
        ))}
      </ul>
      <ErrorBanner error={error} onRetry={() => void send(lastSent.current)} />
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void send(draft);
        }}
      >
        <input
          className="min-w-0 flex-1 rounded-xl border border-border bg-panel-2 px-3 py-2.5 text-sm outline-none focus:border-accent"
          placeholder="Ask a follow-up…"
          aria-label="Follow-up question"
          maxLength={4000}
          value={draft}
          disabled={streaming}
          onChange={(e) => setDraft(e.currentTarget.value)}
        />
        {streaming ? (
          <Button variant="ghost" onClick={() => abort.current?.abort()}>
            Stop
          </Button>
        ) : (
          <Button type="submit" disabled={draft.trim() === ""}>
            Send
          </Button>
        )}
      </form>
    </section>
  );
}
