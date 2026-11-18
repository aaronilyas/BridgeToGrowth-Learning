import { expect, test } from "bun:test";
import { createElement, memo, act } from "react";
import { createRoot } from "react-dom/client";
import { installTestDom } from "../testDom.ts";
import { MdBlocks } from "./MdBlocks.tsx";

test("completed blocks are not re-parsed when the streaming tail grows", async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const parsed: string[] = [];
  const Body = memo(function Body({ text }: { text: string }) {
    parsed.push(text);
    return createElement("div", null, text);
  });
  const host = installTestDom();
  const root = createRoot(host);
  const first = "First paragraph.\n\nSecond";
  const grown = "First paragraph.\n\nSecond paragraph grows";
  await act(async () => {
    root.render(createElement(MdBlocks, { text: first, Body }));
  });
  expect(parsed).toEqual(["First paragraph.\n\n", "Second"]);
  parsed.length = 0;
  await act(async () => {
    root.render(createElement(MdBlocks, { text: grown, Body }));
  });
  expect(parsed).toEqual(["Second paragraph grows"]);
  await act(async () => { root.unmount(); });
});
