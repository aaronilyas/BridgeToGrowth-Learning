import { memo, type JSX } from "react";
import { Md } from "../components/Md.tsx";
import { QuestionCard, type SentAttempt } from "../components/QuestionCard.tsx";
import { Sources } from "../components/Sources.tsx";
import type { ChatRow } from "./chatStore.ts";
import { splitFollowUp } from "./transcript.ts";

// O(n) in message length
// INV: learner turns sit in a subtle right-aligned bubble; tutor turns are plain prose, and a settled turn's closing question sits in the same card as a check
// INV: memoised, so pass a stable onReply
export const MessageRow = memo(function MessageRow({ row, open, onReply }: { row: ChatRow; open: boolean; onReply: (sent: SentAttempt) => void }): JSX.Element {
  if (row.role === "user") {
    return (
      <li className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl bg-panel-2 px-4 py-2.5 text-sm">
          <span className="sr-only">You: </span>
          <Md text={row.content} className="[&_p]:my-0.5" />
        </div>
      </li>
    );
  }
  const followUp = row.pending ? null : splitFollowUp(row.content);
  const prose = followUp ? followUp.lead : row.content;
  return (
    <li className="flex flex-col gap-2">
      <span className="sr-only">Tutor: </span>
      {row.pending && row.content === "" ? <span className="animate-pulse font-mono text-xs text-muted motion-reduce:animate-none">Thinking…</span> : prose !== "" && <Md text={prose} className="reading [&_p:first-child]:mt-0" />}
      {followUp && (
        <div className="pt-4">
          <QuestionCard question={{ id: row.id, kind: "free", category: null, stem: followUp.question, choices: null, code: null, codeTests: null }} caption="Follow-up" label="Tutor's follow-up question" closed={!open} onReply={onReply} />
        </div>
      )}
      {!row.pending && <Sources citations={row.citations} />}
    </li>
  );
});

// O(n) in rows
export function Messages({ rows, openId, onReply }: { rows: readonly ChatRow[] | undefined; openId: string | null; onReply: (sent: SentAttempt) => void }): JSX.Element | null {
  if (!rows || rows.length === 0) return null;
  return (
    <ul className="flex flex-col gap-8">
      {rows.map((r) => (
        <MessageRow key={r.id} row={r} open={r.id === openId} onReply={onReply} />
      ))}
    </ul>
  );
}
