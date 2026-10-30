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
type ChatSnap = { rows: Row[]; streaming: boolean; error: unknown; retry: string };
type ChatJob = ChatSnap & { abort: AbortController };

// INV: jobs outlive the panel. Leaving the lesson page unsubscribes only; Stop is the only abort.
const chatJobs = new Map<string, ChatJob>();
const chatWatchers = new Map<string, Set<(snap: ChatSnap) => void>>();

// O(n) in text length
// INV: streamed text may carry markers the server later strips; keep only [n] that the end event actually cites
function keepCited(text: string, cites: Citation[]): string {
  const ok = new Set(cites.map((c) => c.n));
  return text.replace(/\[(\d{1,9})\]/g, (m, d: string) => (ok.has(Number(d)) ? m : ""));
}

// O(1)
function chatSnap(job: ChatJob): ChatSnap {
  return { rows: job.rows, streaming: job.streaming, error: job.error, retry: job.retry };
}

// O(n) in saved messages plus the optimistic tail
// INV: history ids are server integers; u- and a- ids are the turn still in flight
// INV: an optimistic turn is dropped only when the saved tail is that same turn, so an older identical reply stays put
function mergeChatRows(history: Row[], current: Row[]): Row[] {
  const optimistic = current.filter((r) => r.id.startsWith("u-") || r.id.startsWith("a-"));
  const tail = history.slice(-optimistic.length);
  const saved = optimistic.length > 0 && tail.length === optimistic.length && tail.every((r, i) => r.role === optimistic[i]?.role && r.content === optimistic[i]?.content);
  return saved ? history : [...history, ...optimistic];
}

// O(n) in messages
function historyChatRows(ms: MessageResponse[]): Row[] {
  return [...ms].reverse().map((m) => ({ id: m.id, role: m.role, content: m.content, citations: m.citations, pending: false }));
}

// O(1)
// INV: the job is dropped before abort, so a late stream result cannot revive it
export function stopLessonChat(lessonId: string): void {
  const job = chatJobs.get(lessonId);
  chatJobs.delete(lessonId);
  chatWatchers.delete(lessonId);
  job?.abort.abort();
}

// O(listeners)
function emitLessonChat(lessonId: string): void {
  const job = chatJobs.get(lessonId);
  if (!job) return;
  const snap = chatSnap(job);
  for (const fn of chatWatchers.get(lessonId) ?? []) fn(snap);
}

// O(1)
function watchLessonChat(lessonId: string, fn: (snap: ChatSnap) => void): () => void {
  let watchers = chatWatchers.get(lessonId);
  if (!watchers) {
    watchers = new Set();
    chatWatchers.set(lessonId, watchers);
  }
  watchers.add(fn);
  const job = chatJobs.get(lessonId);
  if (job) fn(chatSnap(job));
  return () => {
    watchers.delete(fn);
    if (watchers.size === 0) chatWatchers.delete(lessonId);
  };
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
  const existing = chatJobs.get(lessonId);
  const [rows, setRows] = useState<Row[]>(existing?.rows ?? []);
  const [draft, setDraft] = useState(existing?.error ? existing.retry : "");
  const [streaming, setStreaming] = useState(existing?.streaming ?? false);
  const [error, setError] = useState<unknown>(existing?.error ?? null);
  const lastSent = useRef(existing?.retry ?? "");
  const baseRows = useRef<Row[]>(existing?.rows ?? []);
  const list = useRef<HTMLUListElement>(null);

  useEffect(() => {
    let live = true;
    const apply = (snap: ChatSnap): void => {
      baseRows.current = snap.rows;
      setRows(snap.rows);
      setStreaming(snap.streaming);
      setError(snap.error);
      if (snap.error) setDraft((d) => (d.trim() === "" ? snap.retry : d));
    };
    const unwatch = watchLessonChat(lessonId, apply);
    api(`/api/lessons/${lessonId}/messages`, z.array(MessageResponse)).then(
      (ms) => {
        if (!live) return;
        const history = historyChatRows(ms);
        const job = chatJobs.get(lessonId);
        if (job) {
          job.rows = mergeChatRows(history, job.rows);
          emitLessonChat(lessonId);
          return;
        }
        setRows((cur) => {
          const next = mergeChatRows(history, cur);
          baseRows.current = next;
          return next;
        });
      },
      (e: unknown) => live && !chatJobs.get(lessonId) && setError(e),
    );
    return () => {
      live = false;
      unwatch();
    };
  }, [lessonId]);

  useEffect(() => {
    const el = list.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [rows]);

  const send = useCallback(async (message: string): Promise<void> => {
    const text = message.trim();
    const active = chatJobs.get(lessonId);
    if (text === "" || active?.streaming) return;
    lastSent.current = text;
    const ctl = new AbortController();
    const stamp = `${Date.now()}`;
    const uid = `u-${stamp}`;
    const aid = `a-${stamp}`;
    const job: ChatJob = {
      abort: ctl,
      streaming: true,
      error: null,
      retry: text,
      rows: [...(active?.rows ?? baseRows.current), { id: uid, role: "user", content: text, citations: [], pending: false }, { id: aid, role: "assistant", content: "", citations: [], pending: true }],
    };
    chatJobs.set(lessonId, job);
    emitLessonChat(lessonId);
    setDraft("");
    const patch = (fn: (r: Row) => Row): void => {
      const current = chatJobs.get(lessonId);
      if (!current || current.abort !== ctl) return;
      current.rows = current.rows.map((r) => (r.id === aid ? fn(r) : r));
      emitLessonChat(lessonId);
    };
    try {
      await streamSse(`/api/lessons/${lessonId}/chat`, { message: text }, (e) => {
        if (e.t === "d") patch((r) => ({ ...r, content: r.content + e.v }));
        else if (e.t === "end") {
          const cites = e.citations ?? [];
          patch((r) => ({ ...r, content: keepCited(r.content, cites), citations: cites, pending: false }));
        } else throw makeApiError(0, e.code);
      }, ctl.signal);
      const current = chatJobs.get(lessonId);
      if (!current || current.abort !== ctl) return;
      current.streaming = false;
      current.rows = current.rows.map((r) => (r.id === aid ? { ...r, pending: false } : r));
      emitLessonChat(lessonId);
      chatJobs.delete(lessonId);
    } catch (e) {
      const current = chatJobs.get(lessonId);
      if (!current || current.abort !== ctl) return;
      current.streaming = false;
      if (ctl.signal.aborted) {
        current.rows = current.rows.map((r) => (r.id === aid ? { ...r, pending: false } : r));
        emitLessonChat(lessonId);
        chatJobs.delete(lessonId);
      } else {
        current.error = e;
        current.retry = text;
        current.rows = current.rows.filter((r) => r.id !== aid && r.id !== uid);
        emitLessonChat(lessonId);
      }
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
      <ErrorBanner error={error} onRetry={() => void send(chatJobs.get(lessonId)?.retry || lastSent.current)} />
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
          <Button variant="ghost" onClick={() => chatJobs.get(lessonId)?.abort.abort()}>
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
