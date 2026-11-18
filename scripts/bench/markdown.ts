// Renderer bench: streamed-reply render cost and long-transcript mount cost, in the test DOM.
// Run: bun scripts/bench/markdown.ts [replyChars=6000] [charsPerFrame=30] [rows=500]
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { installTestDom } from "../../src/web/testDom.ts";
import { shortReply, tutorReply } from "./fixtures.ts";

const [replyChars = 6000, step = 30, rowCount = 500] = process.argv.slice(2).map(Number);
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const host = installTestDom();
(document as { compatMode?: string }).compatMode = "CSS1Compat";
const { Messages } = await import("../../src/web/lesson/Messages.tsx");
type Row = Parameters<typeof Messages>[0]["rows"][number];
const props = { anchors: new Map<number, string>(), answered: {}, onResult: () => {}, openId: null, onReply: () => {} };
const row = (id: string, role: Row["role"], content: string, pending: boolean): Row => ({ id, role, content, citations: [], pending, topicIdx: null, check: null, finishes: false, preparingCheck: false });

// warm the lazy renderer chunk and KaTeX so the first frame is not charged for module load
const warm = createRoot(host);
await act(async () => { warm.render(createElement(Messages, { ...props, rows: [row("w", "assistant", tutorReply(2000, 3), false)] })); });
await act(async () => { warm.unmount(); });

const full = tutorReply(replyChars);
const root = createRoot(host);
const prior = [row("u0", "user", "Explain derivatives", false)];
let total = 0;
let worst = 0;
let frames = 0;
for (let n = step; n < full.length + step; n += step) {
  const text = full.slice(0, Math.min(n, full.length));
  const t0 = performance.now();
  await act(async () => { root.render(createElement(Messages, { ...props, rows: [...prior, row("a1", "assistant", text, true)] })); });
  const dt = performance.now() - t0;
  total += dt;
  worst = Math.max(worst, dt);
  frames++;
}
const ts = performance.now();
await act(async () => { root.render(createElement(Messages, { ...props, rows: [...prior, row("a1", "assistant", full, false)] })); });
const settle = performance.now() - ts;
await act(async () => { root.unmount(); });
console.log(`stream: ${replyChars} chars, ${frames} frames of ${step} chars: total ${total.toFixed(0)} ms, worst frame ${worst.toFixed(1)} ms, mean ${(total / frames).toFixed(2)} ms, settle ${settle.toFixed(1)} ms`);

const rows: Row[] = Array.from({ length: rowCount }, (_, i) => (i % 2 === 0 ? row(`u${i}`, "user", `Question ${i}: why does $x^${i % 9}$ grow?`, false) : row(`a${i}`, "assistant", shortReply(i), false)));
const big = createRoot(host);
const tm = performance.now();
await act(async () => { big.render(createElement(Messages, { ...props, rows })); });
console.log(`mount: ${rowCount} rows in ${(performance.now() - tm).toFixed(0)} ms (test DOM; excludes browser layout/paint)`);
await act(async () => { big.unmount(); });
