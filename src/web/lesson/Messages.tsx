import { memo, type JSX } from "react";
import type { AttemptResponse, CheckAttempt } from "../../shared/api.ts";
import { Md } from "../components/Md.tsx";
import { QuestionCard } from "../components/QuestionCard.tsx";
import { Sources } from "../components/Sources.tsx";
import type { ChatRow } from "./chatStore.ts";
import { tutorFollowUp, type SentAttempt } from "./transcript.ts";

export type OnCheckResult = (questionId: string, r: AttemptResponse, sent: SentAttempt) => void;
export type OnFollowUpReply = (sent: SentAttempt) => void;

// O(n) in message length
// INV: learner turns sit in a subtle right-aligned bubble; tutor turns are plain prose, with any check below them, and a settled turn's closing question sits in the same card as a check
// INV: memoised, so a streaming turn does not re-render or re-typeset earlier messages; pass a stable onResult and onReply
export const MessageRow = memo(function MessageRow({ row, anchor, answered, onResult, open, onReply }: { row: ChatRow; anchor: string | undefined; answered: CheckAttempt | null; onResult: OnCheckResult; open: boolean; onReply: OnFollowUpReply }): JSX.Element {
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
  const question = row.check?.question ?? null;
  const followUp = tutorFollowUp(row);
  const prose = followUp ? followUp.lead : row.content;
  return (
    <li id={anchor} className="flex scroll-mt-6 flex-col gap-4">
      <span className="sr-only">Tutor: </span>
      {row.pending && row.content === "" ? <span className="animate-pulse font-mono text-xs text-muted motion-reduce:animate-none">Thinking…</span> : prose !== "" && <Md text={prose} className="reading [&_p:first-child]:mt-0" />}
      {row.preparingCheck && <span className="animate-pulse font-mono text-xs text-muted motion-reduce:animate-none">Writing a question…</span>}
      {question && <QuestionCard key={question.id} question={question} label="Check" answered={answered} onResult={(r, sent) => onResult(question.id, r, sent)} />}
      {followUp && <QuestionCard question={{ id: row.id, kind: "free", category: null, stem: followUp.question, choices: null, code: null, codeTests: null }} caption="Follow-up" label="Tutor's follow-up question" closed={!open} onReply={onReply} />}
      {!row.pending && <Sources citations={row.citations} />}
    </li>
  );
});

// O(n) in rows
// INV: answered holds attempts made since the transcript loaded and takes precedence over the saved attempt on the row
export function Messages({ rows, anchors, answered, onResult, openId, onReply }: { rows: readonly ChatRow[]; anchors: ReadonlyMap<number, string>; answered: Readonly<Record<string, CheckAttempt>>; onResult: OnCheckResult; openId: string | null; onReply: OnFollowUpReply }): JSX.Element | null {
  if (rows.length === 0) return null;
  const anchorOf = new Map([...anchors].map(([topic, id]) => [id, `topic-${topic}`]));
  return (
    <ul className="flex flex-col gap-8">
      {rows.map((r) => (
        <MessageRow key={r.id} row={r} anchor={anchorOf.get(r.id)} answered={(r.check && answered[r.check.question.id]) ?? r.check?.lastAttempt ?? null} onResult={onResult} open={r.id === openId} onReply={onReply} />
      ))}
    </ul>
  );
}
