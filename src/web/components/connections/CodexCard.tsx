import { useEffect, useState, type JSX } from "react";
import { LoginState, type ConnectionStatus } from "../../../shared/providers.ts";
import { api, describeError } from "../../api.ts";
import { Button } from "../Button.tsx";
import { Panel } from "../Panel.tsx";

// O(1)
function codexStatusLine(status: ConnectionStatus): string {
  if (status.connected || status.detail === "ok") return "Connected";
  if (status.detail === "cli_missing") return "The official Codex CLI is not installed.";
  if (status.detail === "logged_out") return "Not signed in.";
  if (status.detail === "unreachable") return "Codex could not be reached.";
  return "Not connected";
}

// O(1) per poll
export function CodexCard({ status, onChanged }: { status: ConnectionStatus; onChanged: () => Promise<void> }): JSX.Element {
  const [phase, setPhase] = useState<LoginState["state"]>("idle");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (phase !== "pending") return;
    let live = true;
    const tick = (): void => {
      void api("/api/providers/codex/login", LoginState).then((row) => {
        if (!live || row.state === "pending") return;
        setPhase(row.state);
        if (row.state === "failed") setError("Sign-in did not finish. Try again.");
        void onChanged();
      }, (cause: unknown) => {
        if (live) setError(describeError(cause));
      });
    };
    const id = window.setInterval(tick, 2000);
    return () => {
      live = false;
      window.clearInterval(id);
    };
  }, [phase, onChanged]);

  async function startCodexSignIn(): Promise<void> {
    setBusy(true);
    setError("");
    try {
      const row = await api("/api/providers/codex/login", LoginState, { method: "POST" });
      setPhase(row.state);
      if (row.state === "failed") setError("Sign-in did not finish. Install the official Codex CLI and try again.");
      if (row.state === "ok" || row.state === "failed") await onChanged();
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(false);
    }
  }

  const waiting = phase === "pending";
  return (
    <Panel>
      <h3 className="text-base font-semibold">Codex</h3>
      <p className="mt-1 text-sm text-muted">Subscription. Codex uses your ChatGPT plan limits through the official Codex CLI, which must be installed and signed in.</p>
      <p className="mt-3 text-sm">{waiting ? "Waiting for you to finish in the browser…" : codexStatusLine(status)}</p>
      {status.detail === "cli_missing" && (
        <p className="mt-2 text-sm text-muted">Install the official Codex CLI so the `codex` command is on your PATH. Then sign in with ChatGPT here.</p>
      )}
      {status.detail === "logged_out" && (
        <div className="mt-3">
          <Button busy={busy || waiting} disabled={busy || waiting} onClick={() => void startCodexSignIn()}>
            {waiting ? "Waiting for sign-in…" : "Sign in with ChatGPT"}
          </Button>
        </div>
      )}
      {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
    </Panel>
  );
}
