import { useEffect, useState, type JSX } from "react";
import { z } from "zod";
import { LoginState, type ConnectionStatus, type LoginMethod } from "../../../shared/providers.ts";
import { api, describeError } from "../../api.ts";
import { openExternalTarget } from "../../openExternal.ts";
import { Button } from "../Button.tsx";
import { Panel } from "../Panel.tsx";

const IDLE: LoginState = { state: "idle", method: "device" };

// O(1)
function codexStatusLine(status: ConnectionStatus): string {
  if (status.connected || status.detail === "ok") return "Connected with your ChatGPT plan";
  if (status.detail === "cli_missing") return "The official Codex CLI is not installed.";
  if (status.detail === "logged_out") return "Not signed in.";
  if (status.detail === "unreachable") return "Codex could not be reached.";
  return "Not connected";
}

// O(1)
function codexFailureText(method: LoginMethod): string {
  if (method === "device") return "Sign-in did not finish. If device-code sign-in is turned off for your ChatGPT account, use browser sign-in instead.";
  return "Sign-in did not finish. Try again.";
}

// O(1)
function CodexPending({ row, onOpen, onCancel }: { row: LoginState; onOpen: () => void; onCancel: () => void }): JSX.Element {
  const [copied, setCopied] = useState(false);
  async function copyDeviceCode(code: string): Promise<void> {
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
            <span>Open OpenAI's sign-in page and sign in to ChatGPT.</span>
            <div className="mt-2"><Button variant="soft" disabled={row.url === undefined} onClick={onOpen}>Open sign-in page</Button></div>
            {row.url && <p className="mt-1 break-all text-muted select-all">{row.url}</p>}
          </li>
          <li>
            <span>Enter this one-time code (it expires in 15 minutes):</span>
            {row.code ? (
              <div className="mt-2 flex items-center gap-3">
                <code className="rounded-lg border border-border bg-panel-2 px-3 py-1.5 font-mono text-base tracking-widest select-all">{row.code}</code>
                <Button variant="ghost" onClick={() => void copyDeviceCode(row.code ?? "")}>{copied ? "Copied" : "Copy"}</Button>
              </div>
            ) : (
              <p className="mt-1 text-muted">Waiting for the Codex CLI…</p>
            )}
          </li>
        </ol>
      ) : (
        <div>
          <p>Your browser should open OpenAI's sign-in page. Finish signing in there.</p>
          {row.url && <div className="mt-2"><Button variant="soft" onClick={onOpen}>Open it again</Button></div>}
        </div>
      )}
      <p className="text-muted">This sign-in was started from BridgeToGrowth, which runs your official Codex CLI. Cancelling leaves Codex signed out.</p>
      <div><Button variant="ghost" onClick={onCancel}>Cancel</Button></div>
    </div>
  );
}

// O(1) per poll
export function CodexCard({ status, onChanged }: { status: ConnectionStatus; onChanged: () => Promise<void> }): JSX.Element {
  const [row, setRow] = useState<LoginState>(IDLE);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"start" | "signout" | null>(null);
  const waiting = row.state === "pending";

  useEffect(() => {
    if (!waiting) return;
    let live = true;
    const tick = (): void => {
      void api("/api/providers/codex/login", LoginState).then((next) => {
        if (!live) return;
        setRow(next);
        if (next.state === "pending") return;
        if (next.state === "failed") setError(codexFailureText(next.method));
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
  }, [waiting, onChanged]);

  async function startCodexSignIn(method: LoginMethod): Promise<void> {
    setBusy("start");
    setError("");
    try {
      const next = await api("/api/providers/codex/login", LoginState, { method: "POST", body: { method } });
      setRow(next);
      if (next.state === "failed") setError(codexFailureText(method));
      if (next.state !== "pending") await onChanged();
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(null);
    }
  }

  async function cancelCodexSignIn(): Promise<void> {
    setRow(IDLE);
    try {
      await api("/api/providers/codex/login", z.undefined(), { method: "DELETE" });
    } catch (cause) {
      setError(describeError(cause));
    }
    await onChanged();
  }

  async function signOutOfCodex(): Promise<void> {
    setBusy("signout");
    setError("");
    try {
      await api("/api/providers/codex/logout", z.undefined(), { method: "POST" });
      setRow(IDLE);
      await onChanged();
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(null);
    }
  }

  function openCodexPage(target: "codex_signin" | "codex_install"): void {
    void openExternalTarget(target).catch((cause: unknown) => setError(describeError(cause)));
  }

  return (
    <Panel>
      <h3 className="text-base font-semibold">Codex</h3>
      <p className="mt-1 text-sm text-muted">Subscription. Codex uses your ChatGPT plan limits through the official Codex CLI. You sign in on OpenAI's own page; BridgeToGrowth never sees your password or sign-in tokens.</p>
      <p className="mt-3 text-sm">{waiting ? "Waiting for you to finish signing in…" : codexStatusLine(status)}</p>
      {status.detail === "cli_missing" && !waiting && (
        <div className="mt-3 grid gap-3 text-sm">
          <p className="text-muted">Install the official Codex CLI (for example `npm install -g @openai/codex`), then check again.</p>
          <div className="flex flex-wrap gap-3">
            <Button variant="soft" onClick={() => openCodexPage("codex_install")}>Install instructions</Button>
            <Button variant="ghost" onClick={() => void onChanged()}>Check again</Button>
          </div>
        </div>
      )}
      {status.detail === "logged_out" && !waiting && (
        <div className="mt-3 flex flex-wrap gap-3">
          <Button busy={busy === "start"} disabled={busy !== null} onClick={() => void startCodexSignIn("device")}>Sign in with ChatGPT</Button>
          <Button variant="ghost" disabled={busy !== null} onClick={() => void startCodexSignIn("browser")}>Use browser sign-in instead</Button>
        </div>
      )}
      {waiting && <CodexPending row={row} onOpen={() => openCodexPage("codex_signin")} onCancel={() => void cancelCodexSignIn()} />}
      {status.connected && !waiting && (
        <div className="mt-3">
          <Button variant="danger" busy={busy === "signout"} disabled={busy !== null} onClick={() => void signOutOfCodex()}>Sign out</Button>
        </div>
      )}
      {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
    </Panel>
  );
}
