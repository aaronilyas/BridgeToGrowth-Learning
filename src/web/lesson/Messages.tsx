import { memo, type JSX } from "react";
import { Md } from "../components/Md.tsx";
import { Sources } from "../components/Sources.tsx";
import type { ChatRow } from "./chatStore.ts";

// O(n) in message length
// INV: learner turns sit in a subtle right-aligned bubble; tutor turns are plain prose
export const MessageRow = memo(function MessageRow({ row }: { row: ChatRow }): JSX.Element {
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
  return (
    <li className="flex flex-col gap-2">
      <span className="sr-only">Tutor: </span>
      {row.pending && row.content === "" ? <span className="animate-pulse font-mono text-xs text-muted motion-reduce:animate-none">Thinking…</span> : <Md text={row.content} className="[&>p:first-child]:mt-0" />}
      {!row.pending && <Sources citations={row.citations} />}
    </li>
  );
});

// O(n) in rows
export function Messages({ rows }: { rows: readonly ChatRow[] | undefined }): JSX.Element | null {
  if (!rows || rows.length === 0) return null;
  return (
    <ul className="flex flex-col gap-5">
      {rows.map((r) => (
        <MessageRow key={r.id} row={r} />
      ))}
    </ul>
  );
}
