import type { JSX } from "react";
import type { ConnectionStatus, SubscriptionDetail } from "../../../shared/providers.ts";
import { Panel } from "../Panel.tsx";
import { CliSignIn, type CliCopy } from "./CliSignIn.tsx";

const CODEX_COPY: CliCopy = {
  provider: "codex",
  account: "ChatGPT",
  vendor: "OpenAI",
  cli: "Codex CLI",
  installHint: "Install the official Codex CLI (for example `npm install -g @openai/codex`), then check again.",
  connectedLine: "Connected with your ChatGPT plan",
  signInTarget: "codex_signin",
  installTarget: "codex_install",
};

// O(1)
function codexDetailOf(status: ConnectionStatus): SubscriptionDetail {
  if (status.connected) return "ok";
  return status.detail === "cli_missing" ? "cli_missing" : "logged_out";
}

// O(1)
export function CodexCard({ status, onChanged }: { status: ConnectionStatus; onChanged: () => Promise<void> }): JSX.Element {
  return (
    <Panel>
      <h3 className="text-base font-semibold">Codex</h3>
      <p className="mt-1 text-sm text-muted">Subscription. Codex uses your ChatGPT plan limits through the official Codex CLI. You sign in on OpenAI's own page; BridgeToGrowth never sees your password or sign-in tokens.</p>
      <CliSignIn detail={codexDetailOf(status)} copy={CODEX_COPY} onChanged={onChanged} />
    </Panel>
  );
}
