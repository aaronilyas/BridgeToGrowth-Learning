import { useState, type JSX } from "react";
import type { ConnectionStatus } from "../../../shared/providers.ts";
import { describeError } from "../../api.ts";
import { openExternalTarget } from "../../openExternal.ts";
import { Button } from "../Button.tsx";
import { Panel } from "../Panel.tsx";

// O(1)
function claudeStatusLine(status: ConnectionStatus): string {
  if (status.connected) return "Connected through your Claude Code sign-in.";
  if (status.detail === "cli_missing") return "Claude Code is not installed.";
  return "Claude Code is installed but not signed in.";
}

// O(1)
// INV: the app never signs in to or out of Claude Code; the user does that in their own terminal and the card only reports it
export function ClaudeCard({ status, onChanged }: { status: ConnectionStatus; onChanged: () => Promise<void> }): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function checkClaudeAgain(): Promise<void> {
    setBusy(true);
    setError("");
    try {
      await onChanged();
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel>
      <h3 className="text-base font-semibold">Claude</h3>
      <p className="mt-1 text-sm text-muted">Subscription. Claude uses the Claude plan you are already signed in to in Claude Code, through the Agent Client Protocol. BridgeToGrowth never sees your password or sign-in tokens, and runs Claude with every tool turned off.</p>
      <p className="mt-3 text-sm">{claudeStatusLine(status)}</p>
      {status.detail === "cli_missing" && (
        <div className="mt-3 grid gap-3 text-sm">
          <p className="text-muted">Install Claude Code, sign in to it, then check again.</p>
          <div className="flex flex-wrap gap-3">
            <Button variant="soft" onClick={() => void openExternalTarget("claude_install").catch((cause: unknown) => setError(describeError(cause)))}>Install instructions</Button>
            <Button variant="ghost" busy={busy} disabled={busy} onClick={() => void checkClaudeAgain()}>Check again</Button>
          </div>
        </div>
      )}
      {status.detail === "logged_out" && (
        <div className="mt-3 grid gap-3 text-sm">
          <p className="text-muted">Open a terminal, run <code className="font-mono">claude auth login</code> (or start <code className="font-mono">claude</code> and use <code className="font-mono">/login</code>), finish signing in, then check again.</p>
          <div><Button variant="ghost" busy={busy} disabled={busy} onClick={() => void checkClaudeAgain()}>Check again</Button></div>
        </div>
      )}
      {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
    </Panel>
  );
}
