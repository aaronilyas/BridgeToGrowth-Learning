import type { JSX } from "react";
import { ConnectionCards } from "../components/connections/ConnectionCards.tsx";
import { Logo } from "../components/Logo.tsx";
import { Panel } from "../components/Panel.tsx";

// O(1)
export function FirstRunPage(): JSX.Element {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col justify-center gap-6 p-6">
      <Logo />
      <header>
        <h1 className="text-2xl font-semibold">Connect an AI provider</h1>
        <p className="mt-2 text-sm text-muted">BridgeToGrowth runs on this computer. Lessons, chat, and practice stay closed until one provider is connected.</p>
      </header>
      <Panel>
        <h2 className="text-lg font-semibold">How you pay</h2>
        <ul className="mt-3 grid gap-3 text-sm text-muted">
          <li><span className="font-medium text-text">API key.</span> OpenRouter and SpaceXAI bill your own provider account for each use.</li>
          <li><span className="font-medium text-text">Subscription.</span> Codex uses your ChatGPT plan limits. The official Codex CLI must be installed and signed in.</li>
        </ul>
      </Panel>
      <ConnectionCards />
      <p className="text-sm text-muted">The app opens as soon as one provider is connected.</p>
    </div>
  );
}
