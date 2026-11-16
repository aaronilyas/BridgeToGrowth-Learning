import { afterEach, expect, test } from "bun:test";
import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { stopLessonChat, useLessonChat, type ChatTurn } from "./chatStore.ts";
import { installTestDom } from "../testDom.ts";

type Bag = {
  renders: number;
  text: string;
  pending: boolean;
  preparing: boolean;
  streaming: boolean;
  error: unknown;
  rows: number;
  send: (turn: ChatTurn) => boolean;
  stop: () => void;
};

type Stream = { push: (data: unknown) => void; close: () => void; ready: () => boolean; restore: () => void };
type Frames = { flush: () => void; pending: () => number };

const host = installTestDom();
const jobs: string[] = [];

function installFrames(): Frames {
  const queue = new Map<number, FrameRequestCallback>();
  let next = 1;
  globalThis.requestAnimationFrame = (cb) => {
    const id = next++;
    queue.set(id, cb);
    return id;
  };
  globalThis.cancelAnimationFrame = (id) => {
    queue.delete(id);
  };
  return {
    pending: () => queue.size,
    flush() {
      const nextFrame = queue.entries().next().value;
      if (!nextFrame) return;
      queue.delete(nextFrame[0]);
      nextFrame[1](0);
    },
  };
}

function installFetch(): Stream {
  const enc = new TextEncoder();
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  const saved = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/messages")) return Response.json([]);
    init?.signal?.addEventListener("abort", () => {
      controller?.error(new DOMException("The operation was aborted.", "AbortError"));
    });
    const body = new ReadableStream<Uint8Array>({ start(c) { controller = c; } });
    return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
  }) as typeof fetch;
  return {
    ready: () => controller !== null,
    push(data: unknown) { controller?.enqueue(enc.encode(`data: ${JSON.stringify(data)}\n\n`)); },
    close() { controller?.close(); },
    restore() { globalThis.fetch = saved; },
  };
}

function Probe({ id, bag }: { id: string; bag: Bag }): null {
  const chat = useLessonChat(id);
  bag.renders++;
  const assistant = chat.rows.find((r) => r.role === "assistant");
  bag.text = assistant?.content ?? "";
  bag.pending = assistant?.pending ?? false;
  bag.preparing = assistant?.preparingCheck ?? false;
  bag.streaming = chat.streaming;
  bag.error = chat.error;
  bag.rows = chat.rows.length;
  bag.send = chat.send;
  bag.stop = chat.stop;
  return null;
}

async function tick(): Promise<void> {
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

async function mount(id: string): Promise<{ root: Root; bag: Bag; frames: Frames; stream: Stream }> {
  jobs.push(id);
  const frames = installFrames();
  const stream = installFetch();
  const bag: Bag = { renders: 0, text: "", pending: false, preparing: false, streaming: false, error: null, rows: 0, send: () => false, stop: () => {} };
  const root = createRoot(host);
  await act(async () => { root.render(createElement(Probe, { id, bag })); });
  await tick();
  await act(async () => { bag.send({ text: "hi", checkId: null }); });
  for (let i = 0; i < 5 && !stream.ready(); i++) await tick();
  return { root, bag, frames, stream };
}

afterEach(() => {
  for (const id of jobs) stopLessonChat(id);
  jobs.length = 0;
});

test("deltas in one frame reach React once, on the animation frame", async () => {
  const { root, bag, frames, stream } = await mount("frame");
  const burst = ["a", "b", "c", "d", "e", "f", "g", "h"];
  for (const v of burst) {
    stream.push({ t: "d", v });
    await tick();
  }
  expect(bag.text).toBe("");
  expect(frames.pending()).toBe(1);
  const renders = bag.renders;
  await act(async () => { frames.flush(); });
  expect(bag.text).toBe(burst.join(""));
  expect(bag.renders).toBe(renders + 1);
  expect(bag.streaming).toBe(true);
  await act(async () => { root.unmount(); });
  stream.restore();
});

test("end flushes buffered text and then applies the final payload before the frame", async () => {
  const { root, bag, frames, stream } = await mount("end");
  stream.push({ t: "d", v: "aa" });
  stream.push({ t: "d", v: "bb" });
  await tick();
  expect(bag.text).toBe("");
  stream.push({ t: "end", text: "FINAL", citations: [], topicIdx: 0, finishes: false, check: null });
  await tick();
  expect(bag.text).toBe("FINAL");
  expect(bag.pending).toBe(false);
  expect(frames.pending()).toBe(0);
  stream.close();
  await tick();
  expect(bag.streaming).toBe(false);
  expect(bag.text).toBe("FINAL");
  await act(async () => { frames.flush(); });
  expect(bag.text).toBe("FINAL");
  await act(async () => { root.unmount(); });
  stream.restore();
});

test("prep flushes buffered text immediately", async () => {
  const { root, bag, frames, stream } = await mount("prep");
  stream.push({ t: "d", v: "qq" });
  await tick();
  stream.push({ t: "prep" });
  await tick();
  expect(bag.text).toBe("qq");
  expect(bag.preparing).toBe(true);
  expect(frames.pending()).toBe(0);
  await act(async () => { root.unmount(); });
  stream.restore();
});

test("stop flushes the buffer and a failed turn discards it", async () => {
  const stopped = await mount("stop");
  stopped.stream.push({ t: "d", v: "aa" });
  stopped.stream.push({ t: "d", v: "bb" });
  await tick();
  expect(stopped.bag.text).toBe("");
  await act(async () => { stopped.bag.stop(); });
  await tick();
  expect(stopped.bag.text).toBe("aabb");
  expect(stopped.bag.pending).toBe(false);
  expect(stopped.bag.streaming).toBe(false);
  expect(stopped.frames.pending()).toBe(0);
  await act(async () => { stopped.frames.flush(); });
  expect(stopped.bag.text).toBe("aabb");
  await act(async () => { stopped.root.unmount(); });
  stopped.stream.restore();

  const failed = await mount("fail");
  failed.stream.push({ t: "d", v: "secret" });
  await tick();
  failed.stream.push({ t: "err", code: "upstream" });
  await tick();
  expect(failed.bag.rows).toBe(0);
  expect(failed.bag.text).toBe("");
  expect(failed.bag.error).toBeTruthy();
  expect(failed.frames.pending()).toBe(0);
  await act(async () => { failed.frames.flush(); });
  expect(failed.bag.rows).toBe(0);
  await act(async () => { failed.root.unmount(); });
  failed.stream.restore();
});

test("leaving the page keeps buffered text, and dropping the job discards it", async () => {
  const left = await mount("leave");
  left.stream.push({ t: "d", v: "kept" });
  await tick();
  await act(async () => { left.root.unmount(); });
  await act(async () => { left.frames.flush(); });
  const bag = left.bag;
  bag.renders = 0;
  const root = createRoot(host);
  await act(async () => { root.render(createElement(Probe, { id: "leave", bag })); });
  await tick();
  expect(bag.text).toBe("kept");
  expect(bag.streaming).toBe(true);
  await act(async () => { root.unmount(); });
  left.stream.restore();

  const dropped = await mount("drop");
  dropped.stream.push({ t: "d", v: "gone" });
  await tick();
  stopLessonChat("drop");
  await act(async () => { dropped.frames.flush(); });
  await act(async () => { dropped.root.unmount(); });
  const again = dropped.bag;
  again.text = "stale";
  const root2 = createRoot(host);
  await act(async () => { root2.render(createElement(Probe, { id: "drop", bag: again })); });
  await tick();
  expect(again.text).toBe("");
  expect(again.streaming).toBe(false);
  await act(async () => { root2.unmount(); });
  dropped.stream.restore();
});
