import type { ExternalTarget } from "../shared/providers.ts";
import { RELEASE_REPO } from "../shared/version.ts";

type Opener = (url: string) => boolean;

const FIXED: Record<Exclude<ExternalTarget, "codex_signin" | "spacexai_signin">, string> = {
  openrouter_keys: "https://openrouter.ai/settings/keys",
  spacexai_keys: "https://console.x.ai/",
  codex_install: "https://github.com/openai/codex",
  grok_install: "https://docs.x.ai/build/overview",
  claude_install: "https://github.com/anthropics/claude-code",
  releases: `https://github.com/${RELEASE_REPO}/releases`,
};

let opener: Opener = openWithPlatform;

// O(1)
// SEC: the url is always one of FIXED or a sign-in link (auth.openai.com, accounts.x.ai, auth.x.ai) printed by the official CLI, never renderer input; argv is passed without a shell
function openWithPlatform(url: string): boolean {
  const argv = process.platform === "darwin" ? ["open", url] : process.platform === "win32" ? ["rundll32", "url.dll,FileProtocolHandler", url] : ["xdg-open", url];
  const bin = Bun.which(argv[0] ?? "");
  if (bin === null) return false;
  Bun.spawn([bin, ...argv.slice(1)], { stdin: "ignore", stdout: "ignore", stderr: "ignore" });
  return true;
}

// O(1)
// INV: the desktop shell installs its native opener once at startup; headless runs keep the platform opener
export function setExternalOpener(next: Opener): void {
  opener = next;
}

// O(1)
export function fixedExternalUrl(target: Exclude<ExternalTarget, "codex_signin" | "spacexai_signin">): string {
  return FIXED[target];
}

// O(1)
// SEC: only https URLs on an allowlisted host are opened in the system browser
export function openExternalUrl(url: string): boolean {
  const parsed = URL.parse(url);
  const allowed = new Set(["openrouter.ai", "console.x.ai", "github.com", "auth.openai.com", "docs.x.ai", "accounts.x.ai", "auth.x.ai"]);
  if (parsed === null || parsed.protocol !== "https:" || !allowed.has(parsed.hostname)) return false;
  return opener(parsed.href);
}
