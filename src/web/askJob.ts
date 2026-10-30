import { useSyncExternalStore } from "react";

export type AskMode = "teach" | "practice";
export type AskPhase = "running" | "error";

export type AskSnap = {
  mode: AskMode;
  text: string;
  model: string;
  phase: AskPhase;
  error: unknown;
};

let snap: AskSnap | null = null;
let gen = 0;
const watchers = new Set<() => void>();

// O(1)
function emitAskJob(): void {
  for (const fn of watchers) fn();
}

// O(1)
// INV: a stale id cannot settle a newer request
function takeRunning(id: number): AskSnap | null {
  if (id !== gen || snap?.phase !== "running") return null;
  gen += 1;
  return snap;
}

// O(1)
export function getAskJob(): AskSnap | null {
  return snap;
}

// O(1)
export function subscribeAskJob(onChange: () => void): () => void {
  watchers.add(onChange);
  return () => {
    watchers.delete(onChange);
  };
}

// O(1)
// INV: a second begin while one request is running returns null, so the original lesson stays the one on screen
export function beginAskJob(next: { mode: AskMode; text: string; model: string }): number | null {
  if (snap?.phase === "running") return null;
  gen += 1;
  snap = { mode: next.mode, text: next.text, model: next.model, phase: "running", error: null };
  emitAskJob();
  return gen;
}

// O(1)
export function finishAskJob(id: number): void {
  if (!takeRunning(id)) return;
  snap = null;
  emitAskJob();
}

// O(1)
export function failAskJob(id: number, error: unknown): void {
  const current = takeRunning(id);
  if (!current) return;
  snap = { ...current, phase: "error", error };
  emitAskJob();
}

// O(1)
// INV: drops the visible record only; a later settle for the old id is ignored
export function resetAskJob(): void {
  gen += 1;
  if (!snap) return;
  snap = null;
  emitAskJob();
}

// O(1)
// INV: only a teach request still being planned is the lesson the teach page should show
export function generatingLessonPrompt(job: AskSnap | null): string | null {
  if (job?.phase !== "running" || job.mode !== "teach") return null;
  return job.text;
}

// O(1)
export function useAskJob(): AskSnap | null {
  return useSyncExternalStore(subscribeAskJob, getAskJob, getAskJob);
}
