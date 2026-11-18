import { mock, expect, test } from "bun:test";
import { createElement } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { ChatRow } from "./chatStore.ts";
import type { OnCheckResult, OnFollowUpReply } from "./Messages.tsx";
import { installTestDom } from "../testDom.ts";

const rendered: string[] = [];

mock.module("../components/Md.tsx", () => ({
  Md: ({ text }: { text: string }) => {
    rendered.push(text);
    return null;
  },
}));

const { Messages } = await import("./Messages.tsx");

const onResult: OnCheckResult = () => {};
const onReply: OnFollowUpReply = () => {};

function row(id: string, role: ChatRow["role"], content: string, pending: boolean): ChatRow {
  return { id, role, content, citations: [], pending, topicIdx: null, check: null, finishes: false, preparingCheck: false };
}

// O(n) in DOM nodes
function liClasses(node: HTMLElement): string[] {
  const out: string[] = [];
  const walk = (n: Node): void => {
    if (n.nodeName === "LI") out.push((n as HTMLElement).className);
    n.childNodes.forEach((c) => walk(c));
  };
  walk(node);
  return out;
}

test("a streaming row does not re-render the rows above it", async () => {
  const host = installTestDom();
  const earlierUser = row("u1", "user", "hello", false);
  const earlierTutor = row("a1", "assistant", "Earlier point.", false);
  const streaming = row("a2", "assistant", "partial", true);
  const root = createRoot(host);
  const props = { anchors: new Map<number, string>(), answered: {}, onResult, openId: null, onReply };
  await act(async () => {
    root.render(createElement(Messages, { ...props, rows: [earlierUser, earlierTutor, streaming] }));
  });
  expect(rendered).toEqual(["hello", "Earlier point.", "partial"]);
  rendered.length = 0;
  const grown = row("a2", "assistant", "partial more", true);
  await act(async () => {
    root.render(createElement(Messages, { ...props, rows: [earlierUser, earlierTutor, grown] }));
  });
  expect(rendered).toEqual(["partial more"]);
  await act(async () => { root.unmount(); });
});

test("settled rows above the last three get msg-deferred; the streaming row does not", async () => {
  const host = installTestDom();
  const root = createRoot(host);
  const props = { anchors: new Map<number, string>(), answered: {}, onResult, openId: null, onReply };
  const settled = [row("u1", "user", "q1", false), row("a1", "assistant", "a1", false), row("u2", "user", "q2", false), row("a2", "assistant", "a2", false), row("u3", "user", "q3", false)];
  await act(async () => {
    root.render(createElement(Messages, { ...props, rows: settled }));
  });
  const settledCls = liClasses(host);
  expect(settledCls).toHaveLength(5);
  expect(settledCls[0]?.includes("msg-deferred")).toBe(true);
  expect(settledCls[1]?.includes("msg-deferred")).toBe(true);
  expect(settledCls[2]?.includes("msg-deferred")).toBe(false);
  expect(settledCls[3]?.includes("msg-deferred")).toBe(false);
  expect(settledCls[4]?.includes("msg-deferred")).toBe(false);
  const withStream = [...settled.slice(0, 4), row("a3", "assistant", "partial", true)];
  await act(async () => {
    root.render(createElement(Messages, { ...props, rows: withStream }));
  });
  const streamCls = liClasses(host);
  expect(streamCls[4]?.includes("msg-deferred")).toBe(false);
  await act(async () => { root.unmount(); });
});
