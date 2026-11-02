# BridgeToGrowth Learning

BridgeToGrowth Learning is a desktop learning app. It offers grounded lessons, Socratic chat, active recall, spaced repetition, Python exercises and progress insights. It runs entirely on your computer with your own AI provider. It has no account, no subscription to us, and no server to host.

## How AI is paid for

On first launch the app asks you to connect at least one AI source. You can connect several and pick a default model for each task (lessons, chat, practice generation, and system work such as grading, extraction and insights).

| Source | How you connect | Who pays |
|---|---|---|
| OpenRouter | paste an API key | your OpenRouter account, per use. The app shows the reported cost and can enforce an optional monthly budget. |
| Codex | sign in to the official Codex CLI with ChatGPT | your ChatGPT plan's usage limits. Install the CLI yourself; the app runs `codex exec` with every tool disabled. |
| SpaceXAI | paste an xAI API key | your xAI account, per use. |

API keys are stored in your OS keychain (libsecret, macOS Keychain, or Windows Credential Manager). They are never written to the database, logs or exports. The Usage page shows tokens per provider and model for each month. USD cost appears only where the provider reports it, which is OpenRouter.

## Your data

Everything lives in one SQLite database in the OS app-data directory:

- Linux: `$XDG_DATA_HOME/bridgetogrowth` or `~/.local/share/bridgetogrowth`
- macOS: `~/Library/Application Support/BridgeToGrowth`
- Windows: `%APPDATA%\BridgeToGrowth`

Settings → Data exports a zip of the database. It can also delete all data and stored keys. Paper search uses OpenAlex. You can add a contact email for OpenAlex in Settings; it is optional.

## Python exercises

Code questions run in Pyodide inside the app window, offline, with an import allowlist and a time limit. The check is advisory: the code runs on your own machine, so a result is for self-assessment, not proof.

## Development

Prerequisites: Bun 1.4 or newer. Linux desktop builds also need GTK 3 and WebKitGTK 4.1.

```sh
bun install --frozen-lockfile
bun scripts/fetch-pyodide.ts   # once: verified Pyodide wheels into .cache/pyodide
bun run dev                    # headless backend; prints BTG_URL and BTG_TOKEN
bun run desktop:dev            # the desktop window
bun run typecheck && bun test
bun run smoke                  # /api/health: 200 with the launch token, 401 without
```

The backend binds `127.0.0.1` on a random port. Every `/api` request must carry the per-launch token in `x-btg-token`, so a plain browser tab cannot use the API. The desktop shell injects the token into its window. For headless debugging, use the printed token with `curl -H "x-btg-token: …"`.

Migrations in `db/migrations/` run automatically when the database opens. `bun run migrate [path]` applies them to another file.

## Packaging

`bun run package:linux` builds an AppImage and a .deb. macOS and Windows builds come from CI. Builds are unsigned, and there is no auto-update yet. See [docs/packaging.md](docs/packaging.md).

## Further reading

- [docs/desktop-facts.md](docs/desktop-facts.md): verified facts about the Codex CLI, xAI, Bun and Electrobun that the design relies on, and the residual risks
- [docs/prompt-research.md](docs/prompt-research.md): the research behind the tutoring prompts
- [CLAUDE.md](CLAUDE.md): the contract for code changes
