import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { MessageResponse, type Citation, type LessonCheck } from "../../shared/api.ts";
import { api, makeApiError } from "../api.ts";
import { streamSse } from "../sse.ts";

export type ChatRow = { id: string; role: "user" | "assistant"; content: string; citations: Citation[]; pending: boolean; topicIdx: number | null; check: LessonCheck | null; finishes: boolean; preparingCheck: boolean };
// INV: opening is the tutor's first turn, with no learner text; checkId names the check this turn answers
export type ChatTurn = { text: string; checkId: string | null; opening?: boolean };
export type ChatSnap = { rows: ChatRow[]; streaming: boolean; error: unknown; retry: ChatTurn | null };
type ChatJob = ChatSnap & { abort: AbortController };

export const LESSONS_CHANGED = "btg:lessons-changed";
const TRANSCRIPT_LIMIT = 500;

// INV: jobs outlive the lesson page. Leaving the page unsubscribes only; Stop is the only abort.
const chatJobs = new Map<string, ChatJob>();
const chatWatchers = new Map<string, Set<(snap: ChatSnap) => void>>();

// O(1)
export function lessonsChanged(): void {
  window.dispatchEvent(new Event(LESSONS_CHANGED));
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
  return [...ms].reverse().map((m) => ({ id: m.id, role: m.role, content: m.content, citations: m.citations, pending: false, topicIdx: m.topicIdx, check: m.check, finishes: m.finishes, preparingCheck: false }));
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
  if ((text === "" && !turn.opening) || active?.streaming) return false;
  const ctl = new AbortController();
  const stamp = `${Date.now()}`;
  const uid = `u-${stamp}`;
  const aid = `a-${stamp}`;
  const blank = { citations: [], topicIdx: null, check: null, finishes: false, preparingCheck: false };
  const job: ChatJob = {
    abort: ctl,
    streaming: true,
    error: null,
    retry: turn,
    rows: [...(active?.rows ?? base), ...(turn.opening ? [] : [{ ...blank, id: uid, role: "user" as const, content: text, pending: false }]), { ...blank, id: aid, role: "assistant", content: "", pending: true }],
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
    cur.rows = cur.rows.map((r) => (r.id === aid ? { ...r, pending: false, preparingCheck: false } : r));
    emit(lessonId);
    chatJobs.delete(lessonId);
    lessonsChanged();
  };
  const path = `/api/lessons/${lessonId}/${turn.opening ? "start" : "chat"}`;
  const body = turn.opening ? {} : { message: text, ...(turn.checkId === null ? {} : { checkId: turn.checkId }) };
  streamSse(path, body, (e) => {
    if (e.t === "d") patch((r) => ({ ...r, content: r.content + e.v }));
    else if (e.t === "prep") patch((r) => ({ ...r, preparingCheck: true }));
    else if (e.t === "end") {
      patch((r) => ({ ...r, content: e.text, citations: e.citations, topicIdx: e.topicIdx, check: e.check, finishes: e.finishes, pending: false, preparingCheck: false }));
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

// INV: ready is true once this lesson's saved messages have loaded, so an empty transcript means the lesson has not started
export type LessonChat = { rows: ChatRow[]; streaming: boolean; error: unknown; retry: ChatTurn | null; ready: boolean; send: (turn: ChatTurn) => boolean; stop: () => void };

// O(n) in messages on mount; O(m) per streamed delta
// INV: history loads once per lesson and merges with any job still streaming from an earlier visit
export function useLessonChat(lessonId: string): LessonChat {
  const [snap, setSnap] = useState<ChatSnap>(() => {
    const job = chatJobs.get(lessonId);
    return job ? snapOf(job) : { rows: [], streaming: false, error: null, retry: null };
  });
  const [ready, setReady] = useState(false);
  const base = useRef<ChatRow[]>(snap.rows);

  useEffect(() => {
    let live = true;
    setReady(false);
    const apply = (s: ChatSnap): void => {
      base.current = s.rows;
      setSnap(s);
    };
    // INV: the page may stay mounted across lessons; start from this lesson's job or an empty transcript
    const job = chatJobs.get(lessonId);
    apply(job ? snapOf(job) : { rows: [], streaming: false, error: null, retry: null });
    const unwatch = watch(lessonId, apply);
    api(`/api/lessons/${lessonId}/messages?limit=${TRANSCRIPT_LIMIT}`, z.array(MessageResponse)).then(
      (ms) => {
        if (!live) return;
        setReady(true);
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
  return { ...snap, ready, send, stop };
}
