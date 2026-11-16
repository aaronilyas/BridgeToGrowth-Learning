import type { ConnectionStatus } from "./types.ts";

export const STATUS_TTL_MS = 30_000;

export type StatusCache = { read: () => Promise<ConnectionStatus>; forget: () => void };

// O(1) per read
// INV: concurrent reads share one in-flight check, so a provider's CLI or key probe runs once however many routes ask at the same moment
// INV: a connected result is reused for at most ttlMs from when its check started; a not-connected result is never reused, so a sign-in done in a terminal shows at once
// INV: forget() drops the kept result and detaches any check in flight; the next read asks again, and a check that started before forget() is never kept
// INV: a check that throws is not kept; its callers see the error
export function createStatusCache(check: () => Promise<ConnectionStatus>, ttlMs: number = STATUS_TTL_MS, now: () => number = Date.now): StatusCache {
  let kept: { status: ConnectionStatus; at: number } | null = null;
  let pending: Promise<ConnectionStatus> | null = null;
  let generation = 0;
  return {
    read(): Promise<ConnectionStatus> {
      if (kept !== null && now() - kept.at < ttlMs) return Promise.resolve(kept.status);
      kept = null;
      if (pending !== null) return pending;
      const started = generation;
      const at = now();
      const asked: Promise<ConnectionStatus> = check().then(
        (status) => {
          if (generation === started) {
            pending = null;
            if (status.connected) kept = { status, at };
          }
          return status;
        },
        (error: unknown) => {
          if (generation === started) pending = null;
          throw error;
        },
      );
      pending = asked;
      return asked;
    },
    forget(): void {
      generation += 1;
      kept = null;
      pending = null;
    },
  };
}
