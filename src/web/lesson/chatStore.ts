import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { MessageResponse, type Citation } from "../../shared/api.ts";
import { api, makeApiError } from "../api.ts";
import { streamSse } from "../sse.ts";

export type ChatRow = { id: string; role: "user" | "assistant"; content: string; citations: Citation[]; pending: boolean; stepIdx: number | null };
export type ChatTurn = { text: string; stepIdx: number | null };
export type ChatSnap = { rows: ChatRow[]; streaming: boolean; error: unknown; retry: ChatTurn | null };
type ChatJob = ChatSnap & { abort: AbortController };

export const LESSONS_CHANGED = "btg:lessons-changed";

// INV: jobs outlive the lesson page. Leaving the page unsubscribes only; Stop is the only abort.
const chatJobs = new Map<string, ChatJob>();
const chatWatchers = new Map<string, Set<(snap: ChatSnap) => void>>();

// O(1)
export function lessonsChanged(): void {
  window.dispatchEvent(new Event(LESSONS_CHANGED));
}

// O(n) in text length
// INV: streamed text may carry markers the server later strips; keep only [n] that the end event actually cites
export function keepCited(text: string, cites: Citation[]): string {
  const ok = new Set(cites.map((c) => c.n));
  return text.replace(/\[(\d{1,9})\]/g, (m, d: string) => (ok.has(Number(d)) ? m : ""));
}

// O(n) in saved messages plus the optimistic tail
// INV: history ids are server integers; u- and a- ids are turns sent from this page
// INV: an optimistic turn is dropped only when the saved tail is that same turn, so an older identical reply stays put
export function mergeChatRows(history: ChatRow[], current: ChatRow[]): ChatRow[] {
  const optimistic = current.filter((r) => r.id.startsWith("u-") || r.id.startsWith("a-"));
  const tail = history.slice(-optimistic.length);
  const saved = optimistic.length > 0 && tail.length === optimistic.length && tail.every((r, i) => r.role === optimistic[i]?.role && r.content === optimistic[i]?.content);
  return saved ? history : [...history, ...optimistic];
}

// O(n) in messages
// INV: the endpoint lists newest first; rows are oldest first
export function historyChatRows(ms: MessageResponse[]): ChatRow[] {
  return [...ms].reverse().map((m) => ({ id: m.id, role: m.role, content: m.content, citations: m.citations, pending: false, stepIdx: m.stepIdx }));
}

// O(1)
function snapOf(job: ChatJob): ChatSnap {
  return { rows: job.rows, streaming: job.streaming, error: job.error, retry: job.retry };
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
function emit(lessonId: string): void {
  const job = chatJobs.get(lessonId);
  if (!job) return;
  const snap = snapOf(job);
  for (const fn of chatWatchers.get(lessonId) ?? []) fn(snap);
}

// O(1)
function watch(lessonId: string, fn: (snap: ChatSnap) => void): () => void {
  let watchers = chatWatchers.get(lessonId);
  if (!watchers) {
    watchers = new Set();
    chatWatchers.set(lessonId, watchers);
  }
  watchers.add(fn);
  const job = chatJobs.get(lessonId);
  if (job) fn(snapOf(job));
  return () => {
    watchers.delete(fn);
    if (watchers.size === 0) chatWatchers.delete(lessonId);
  };
}

// O(m) per delta in the streaming row only
// INV: one turn at a time per lesson; returns false (and sends nothing) while a turn streams
function sendTurn(lessonId: string, turn: ChatTurn, base: ChatRow[]): boolean {
  const text = turn.text.trim();
  const active = chatJobs.get(lessonId);
  if (text === "" || active?.streaming) return false;
  const ctl = new AbortController();
  const stamp = `${Date.now()}`;
  const uid = `u-${stamp}`;
  const aid = `a-${stamp}`;
  const { stepIdx } = turn;
  const job: ChatJob = {
    abort: ctl,
    streaming: true,
    error: null,
    retry: { text, stepIdx },
    rows: [...(active?.rows ?? base), { id: uid, role: "user", content: text, citations: [], pending: false, stepIdx }, { id: aid, role: "assistant", content: "", citations: [], pending: true, stepIdx }],
  };
  chatJobs.set(lessonId, job);
  emit(lessonId);
  // O(rows)
  const mine = (): ChatJob | null => {
    const cur = chatJobs.get(lessonId);
    return cur && cur.abort === ctl ? cur : null;
  };
  const patch = (fn: (r: ChatRow) => ChatRow): void => {
    const cur = mine();
    if (!cur) return;
    cur.rows = cur.rows.map((r) => (r.id === aid ? fn(r) : r));
    emit(lessonId);
  };
  const settle = (): void => {
    const cur = mine();
    if (!cur) return;
    cur.streaming = false;
    cur.rows = cur.rows.map((r) => (r.id === aid ? { ...r, pending: false } : r));
    emit(lessonId);
    chatJobs.delete(lessonId);
    lessonsChanged();
  };
  const body = stepIdx === null ? { message: text } : { message: text, stepIdx };
  streamSse(`/api/lessons/${lessonId}/chat`, body, (e) => {
    if (e.t === "d") patch((r) => ({ ...r, content: r.content + e.v }));
    else if (e.t === "end") {
      const cites = e.citations ?? [];
      patch((r) => ({ ...r, content: keepCited(r.content, cites), citations: cites, pending: false }));
    } else throw makeApiError(0, e.code);
  }, ctl.signal).then(settle, (e: unknown) => {
    const cur = mine();
    if (!cur) return;
    if (ctl.signal.aborted) return settle();
    cur.streaming = false;
    cur.error = e;
    cur.rows = cur.rows.filter((r) => r.id !== aid && r.id !== uid);
    emit(lessonId);
  });
  return true;
}

export type LessonChat = { rows: ChatRow[]; streaming: boolean; error: unknown; retry: ChatTurn | null; send: (turn: ChatTurn) => boolean; stop: () => void };

// O(n) in messages on mount; O(m) per streamed delta
// INV: history loads once per lesson and merges with any job still streaming from an earlier visit
export function useLessonChat(lessonId: string): LessonChat {
  const [snap, setSnap] = useState<ChatSnap>(() => {
    const job = chatJobs.get(lessonId);
    return job ? snapOf(job) : { rows: [], streaming: false, error: null, retry: null };
  });
  const base = useRef<ChatRow[]>(snap.rows);

  useEffect(() => {
    let live = true;
    const apply = (s: ChatSnap): void => {
      base.current = s.rows;
      setSnap(s);
    };
    // INV: the page may stay mounted across lessons; start from this lesson's job or an empty transcript
    const job = chatJobs.get(lessonId);
    apply(job ? snapOf(job) : { rows: [], streaming: false, error: null, retry: null });
    const unwatch = watch(lessonId, apply);
    api(`/api/lessons/${lessonId}/messages`, z.array(MessageResponse)).then(
      (ms) => {
        if (!live) return;
        const history = historyChatRows(ms);
        const job = chatJobs.get(lessonId);
        if (job) {
          job.rows = mergeChatRows(history, job.rows);
          emit(lessonId);
          return;
        }
        setSnap((cur) => {
          const rows = mergeChatRows(history, cur.rows);
          base.current = rows;
          return { ...cur, rows };
        });
      },
      (e: unknown) => live && !chatJobs.get(lessonId) && setSnap((cur) => ({ ...cur, error: e })),
    );
    return () => {
      live = false;
      unwatch();
    };
  }, [lessonId]);

  const send = useCallback((turn: ChatTurn): boolean => sendTurn(lessonId, turn, base.current), [lessonId]);
  const stop = useCallback((): void => chatJobs.get(lessonId)?.abort.abort(), [lessonId]);
  return { ...snap, send, stop };
}
