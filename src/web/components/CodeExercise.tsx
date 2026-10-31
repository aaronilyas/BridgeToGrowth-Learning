import { useState, type JSX, type KeyboardEvent } from "react";
import { CODE_MAX_CHARS, CodeRunResponse, type CodeSpec, type CodeTestResult } from "../../shared/code.ts";
import { api } from "../api.ts";
import { Button } from "./Button.tsx";
import { ErrorBanner } from "./ErrorBanner.tsx";

const INDENT = "    ";

// O(n) in code length
// INV: Tab inserts four spaces at the caret instead of moving focus; Shift+Tab and Escape keep normal focus behaviour
function indentOnTab(e: KeyboardEvent<HTMLTextAreaElement>, onChange: (v: string) => void): void {
  if (e.key !== "Tab" || e.shiftKey) return;
  e.preventDefault();
  const el = e.currentTarget;
  const { selectionStart: a, selectionEnd: b, value } = el;
  onChange(value.slice(0, a) + INDENT + value.slice(b));
  requestAnimationFrame(() => el.setSelectionRange(a + INDENT.length, a + INDENT.length));
}

// O(1)
// SEC: libraries are shown from the question and cannot be changed here; the server runs code only with the question's own libraries
export function LibraryList({ spec }: { spec: CodeSpec }): JSX.Element {
  return (
    <div className="mt-3 rounded-xl border border-border bg-panel-2 px-3 py-2 text-xs">
      <p className="flex flex-wrap items-center gap-1.5">
        <span className="text-muted">Python libraries available:</span>
        {spec.libraries.length === 0 ? <span className="text-muted">built-ins only</span> : spec.libraries.map((l) => <code key={l} className="rounded-md bg-accent-soft px-1.5 py-0.5 font-mono text-accent">{l}</code>)}
      </p>
      <p className="mt-1 text-muted">Installing packages and importing anything else is disabled. Code runs in an offline sandbox with no file access.</p>
    </div>
  );
}

// O(n) in code length
// INV: Run executes the learner's code without the hidden tests; submitting is the parent card's job
export function CodeExercise({ questionId, spec, value, onChange, disabled }: { questionId: string; spec: CodeSpec; value: string; onChange: (v: string) => void; disabled: boolean }): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [out, setOut] = useState<CodeRunResponse | null>(null);

  const run = async (): Promise<void> => {
    if (busy || value.trim() === "") return;
    setBusy(true);
    setError(null);
    try {
      setOut(await api("/api/code/run", CodeRunResponse, { method: "POST", body: { questionId, code: value } }));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <LibraryList spec={spec} />
      <textarea
        className="min-h-56 w-full rounded-xl border border-border bg-panel-2 p-3 font-mono text-sm leading-relaxed outline-none focus:border-accent"
        aria-label="Your Python code"
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        maxLength={CODE_MAX_CHARS}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            void run();
          } else indentOnTab(e, onChange);
        }}
      />
      {!disabled && (
        <div className="flex items-center gap-3">
          <Button variant="soft" busy={busy} disabled={value.trim() === ""} onClick={() => void run()}>
            ▶ Run
          </Button>
          <span className="text-xs text-muted">Ctrl+Enter runs your code. Hidden tests run when you submit.</span>
        </div>
      )}
      <ErrorBanner error={error} />
      {out && <RunOutput out={out} />}
    </div>
  );
}

// O(n) in output size
// SEC: sandbox output is untrusted text and is rendered only as text
function RunOutput({ out }: { out: CodeRunResponse }): JSX.Element {
  const empty = out.stdout === "" && out.stderr === "" && out.error === null;
  return (
    <div role="status" aria-label="Run output" className="rounded-xl border border-border bg-bg p-3 font-mono text-xs">
      <p className="mb-1 font-sans text-muted">Output · {out.durationMs} ms</p>
      {empty && <p className="text-muted">(no output)</p>}
      {out.stdout !== "" && <pre className="whitespace-pre-wrap break-words">{out.stdout}</pre>}
      {out.stderr !== "" && <pre className="whitespace-pre-wrap break-words text-muted">{out.stderr}</pre>}
      {out.error !== null && <pre className="whitespace-pre-wrap break-words text-danger">{out.error}</pre>}
    </div>
  );
}

// O(t) in tests
export function TestResults({ tests, model }: { tests: CodeTestResult[]; model: string }): JSX.Element {
  return (
    <div className="mt-2 flex flex-col gap-2">
      <ul className="flex flex-col gap-1">
        {tests.map((t, i) => (
          <li key={`${i}-${t.name}`} className="flex flex-col">
            <span className={t.passed ? "text-accent" : "text-danger"}>
              {t.passed ? "✓" : "✗"} {t.name}
            </span>
            {t.error && <code className="ml-5 whitespace-pre-wrap break-words text-xs text-muted">{t.error}</code>}
          </li>
        ))}
      </ul>
      <p className="text-muted">Reference solution</p>
      <pre className="overflow-x-auto rounded-xl border border-border bg-bg p-3 font-mono text-xs">{model}</pre>
    </div>
  );
}
