import { useEffect, useState, type JSX } from "react";
import { z } from "zod";
import { LoginState, type ExternalTarget, type LoginMethod, type SubscriptionDetail } from "../../../shared/providers.ts";
import { api, describeError } from "../../api.ts";
import { openExternalTarget } from "../../openExternal.ts";
import { Button } from "../Button.tsx";

const IDLE: LoginState = { state: "idle", method: "device" };

export type CliCopy = {
  provider: "codex" | "spacexai";
  account: string;
  vendor: string;
  cli: string;
  installHint: string;
  connectedLine: string;
  signInTarget: Extract<ExternalTarget, "codex_signin" | "spacexai_signin">;
  installTarget: Extract<ExternalTarget, "codex_install" | "grok_install">;
};

// O(1)
function cliStatusLine(detail: SubscriptionDetail, copy: CliCopy): string {
  if (detail === "ok") return copy.connectedLine;
  if (detail === "cli_missing") return `The official ${copy.cli} is not installed.`;
  return "Not signed in.";
}

// O(1)
function CliPending({ row, copy, onOpen, onCancel }: { row: LoginState; copy: CliCopy; onOpen: () => void; onCancel: () => void }): JSX.Element {
  const [copied, setCopied] = useState(false);
  async function copyLoginCode(code: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }
  return (
    <div className="mt-3 grid gap-3 text-sm">
      {row.method === "device" ? (
        <ol className="grid list-decimal gap-3 pl-5">
          <li>
            <span>Open {copy.vendor}'s sign-in page and sign in to {copy.account}.</span>
            <div className="mt-2"><Button variant="soft" disabled={row.url === undefined} onClick={onOpen}>Open sign-in page</Button></div>
            {row.url && <p className="mt-1 break-all text-muted select-all">{row.url}</p>}
          </li>
          <li>
            <span>Enter or confirm this one-time code:</span>
            {row.code ? (
              <div className="mt-2 flex items-center gap-3">
                <code className="rounded-lg border border-border bg-panel-2 px-3 py-1.5 font-mono text-base tracking-widest select-all">{row.code}</code>
                <Button variant="ghost" onClick={() => void copyLoginCode(row.code ?? "")}>{copied ? "Copied" : "Copy"}</Button>
              </div>
            ) : (
              <p className="mt-1 text-muted">Waiting for the {copy.cli}…</p>
            )}
          </li>
        </ol>
      ) : (
        <div>
          <p>Your browser should open {copy.vendor}'s sign-in page. Finish signing in there.</p>
          {row.url && <div className="mt-2"><Button variant="soft" onClick={onOpen}>Open it again</Button></div>}
        </div>
      )}
      <p className="text-muted">This sign-in was started from BridgeToGrowth, which runs your official {copy.cli}. Cancelling may leave it signed out.</p>
      <div><Button variant="ghost" onClick={onCancel}>Cancel</Button></div>
    </div>
  );
}

// O(1) per poll
export function CliSignIn({ detail, copy, onChanged }: { detail: SubscriptionDetail; copy: CliCopy; onChanged: () => Promise<void> }): JSX.Element {
  const [row, setRow] = useState<LoginState>(IDLE);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"start" | "signout" | null>(null);
  const waiting = row.state === "pending";
  const base = `/api/providers/${copy.provider}`;

  useEffect(() => {
    if (!waiting) return;
    let live = true;
    const tick = (): void => {
      void api(`${base}/login`, LoginState).then((next) => {
        if (!live) return;
        setRow(next);
        if (next.state === "pending") return;
        if (next.state === "failed") setError(next.method === "device" ? "Sign-in did not finish. If device-code sign-in is unavailable for your account, use browser sign-in instead." : "Sign-in did not finish. Try again.");
        void onChanged();
      }, (cause: unknown) => {
        if (live) setError(describeError(cause));
      });
    };
    const id = window.setInterval(tick, 1500);
    return () => {
      live = false;
      window.clearInterval(id);
    };
  }, [waiting, onChanged, base]);

  async function startCliSignIn(method: LoginMethod): Promise<void> {
    setBusy("start");
    setError("");
    try {
      const next = await api(`${base}/login`, LoginState, { method: "POST", body: { method } });
      setRow(next);
      if (next.state === "failed") setError("Sign-in could not start. Try again.");
      if (next.state !== "pending") await onChanged();
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(null);
    }
  }

  async function cancelCliSignIn(): Promise<void> {
    setRow(IDLE);
    try {
      await api(`${base}/login`, z.undefined(), { method: "DELETE" });
    } catch (cause) {
      setError(describeError(cause));
    }
    await onChanged();
  }

  async function signOutOfCli(): Promise<void> {
    setBusy("signout");
    setError("");
    try {
      await api(`${base}/logout`, z.undefined(), { method: "POST" });
      setRow(IDLE);
      await onChanged();
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(null);
    }
  }

  function openCliPage(target: ExternalTarget): void {
    void openExternalTarget(target).catch((cause: unknown) => setError(describeError(cause)));
  }

  return (
    <div>
      <p className="mt-3 text-sm">{waiting ? "Waiting for you to finish signing in…" : cliStatusLine(detail, copy)}</p>
      {detail === "cli_missing" && !waiting && (
        <div className="mt-3 grid gap-3 text-sm">
          <p className="text-muted">{copy.installHint}</p>
          <div className="flex flex-wrap gap-3">
            <Button variant="soft" onClick={() => openCliPage(copy.installTarget)}>Install instructions</Button>
            <Button variant="ghost" onClick={() => void onChanged()}>Check again</Button>
          </div>
        </div>
      )}
      {detail === "logged_out" && !waiting && (
        <div className="mt-3 flex flex-wrap gap-3">
          <Button busy={busy === "start"} disabled={busy !== null} onClick={() => void startCliSignIn("device")}>Sign in with {copy.account}</Button>
          <Button variant="ghost" disabled={busy !== null} onClick={() => void startCliSignIn("browser")}>Use browser sign-in instead</Button>
        </div>
      )}
      {waiting && <CliPending row={row} copy={copy} onOpen={() => openCliPage(copy.signInTarget)} onCancel={() => void cancelCliSignIn()} />}
      {detail === "ok" && !waiting && (
        <div className="mt-3">
          <Button variant="danger" busy={busy === "signout"} disabled={busy !== null} onClick={() => void signOutOfCli()}>Sign out</Button>
        </div>
      )}
      {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
    </div>
  );
}
