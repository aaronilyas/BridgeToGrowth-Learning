import { useEffect, useState, type JSX } from "react";
import { Button } from "../components/Button.tsx";

export type Seed = { text: string; n: number };

// O(1) per keystroke
// INV: Enter sends, Shift+Enter is a newline; while a turn streams the draft stays editable but only Stop acts
// INV: a new `seed` (a failed turn to retry, or a check reply that could not go out) fills the draft only when it is empty
export function Composer({ streaming, onSend, onStop, seed }: { streaming: boolean; onSend: (text: string) => boolean; onStop: () => void; seed: Seed | null }): JSX.Element {
  const [draft, setDraft] = useState("");

  useEffect(() => {
    if (seed) setDraft((d) => (d.trim() === "" ? seed.text : d));
  }, [seed]);

  const send = (): void => {
    if (draft.trim() !== "" && onSend(draft)) setDraft("");
  };

  return (
    <form
      className="flex flex-col gap-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      <div className="flex items-end gap-2 rounded-xl border border-border bg-panel px-3 py-2 focus-within:border-muted">
        <textarea
          rows={1}
          className="max-h-48 min-h-9 flex-1 resize-none bg-transparent py-1.5 text-sm leading-relaxed outline-none [field-sizing:content] placeholder:text-muted/70"
          placeholder="Reply to your tutor…"
          aria-label="Reply to your tutor"
          maxLength={4000}
          value={draft}
          onChange={(e) => setDraft(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              if (!streaming) send();
            }
          }}
        />
        {streaming ? (
          <Button variant="danger" className="border-transparent bg-danger/10" onClick={onStop}>
            Stop
          </Button>
        ) : (
          <Button type="submit" disabled={draft.trim() === ""}>
            Send
          </Button>
        )}
      </div>
      <p className="px-1 font-mono text-xs text-muted">↵ send · ⇧↵ newline</p>
    </form>
  );
}
