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
