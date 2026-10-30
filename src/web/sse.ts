import { StreamEvent } from "../shared/api.ts";
import { parseSseChunk } from "../shared/sse.ts";
import { makeApiError, readApiError } from "./api.ts";

export type SseEvent = StreamEvent;

// O(n) in stream size
// INV: resolves when the stream closes; non-2xx and network failures reject with ApiError; frames that fail StreamEvent are dropped
// INV: aborting via `signal` rejects with the fetch AbortError, which callers ignore
export async function streamSse(path: string, body: unknown, on: (e: SseEvent) => void, signal: AbortSignal): Promise<void> {
  let res: Response;
  try {
    res = await fetch(path, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", accept: "text/event-stream" }, body: JSON.stringify(body), signal });
  } catch (e) {
    if (signal.aborted) throw e;
    throw makeApiError(0, "upstream");
  }
  if (!res.ok) throw await readApiError(res);
  if (!res.body) throw makeApiError(res.status, "internal");
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (value) buf += value;
    const { events, rest } = parseSseChunk(done ? `${buf}\n\n` : buf);
    buf = rest;
    for (const raw of events) {
      const ev = StreamEvent.safeParse(raw);
      if (ev.success) on(ev.data);
    }
    if (done) return;
  }
}
