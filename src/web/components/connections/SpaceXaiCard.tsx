import type { JSX } from "react";
import type { ConnectionStatus } from "../../../shared/providers.ts";
import { Panel } from "../Panel.tsx";
import { CliSignIn, type CliCopy } from "./CliSignIn.tsx";
import { KeyFields } from "./KeyCard.tsx";

const GROK_COPY: CliCopy = {
  provider: "spacexai",
  account: "Grok",
  vendor: "xAI",
  cli: "grok CLI",
  installHint: "Install the official grok CLI (Grok Build), then check again.",
  connectedLine: "Connected with your Grok subscription",
  signInTarget: "spacexai_signin",
  installTarget: "grok_install",
};

// O(1)
export function SpaceXaiCard({ status, onChanged }: { status: ConnectionStatus; onChanged: () => Promise<void> }): JSX.Element {
  return (
    <Panel>
      <h3 className="text-base font-semibold">SpaceXAI</h3>
      <p className="mt-1 text-sm text-muted">Subscription or API key. Sign in with your grok.com subscription through the official grok CLI to use your plan instead of paying per token. You sign in on xAI's own page; BridgeToGrowth never sees your password or sign-in tokens. Subscription models are text-only.</p>
      <CliSignIn detail={status.subscription ?? "logged_out"} copy={GROK_COPY} onChanged={onChanged} />
      <h4 className="mt-5 text-sm font-semibold">Or use an API key</h4>
      <p className="mt-1 text-sm text-muted">The key bills your xAI account per use and is stored only in your system keychain. A signed-in subscription takes priority.</p>
      <KeyFields status={status} onChanged={onChanged} />
    </Panel>
  );
}
