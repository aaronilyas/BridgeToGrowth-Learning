# BridgeToGrowth Learning

BridgeToGrowth Learning is a desktop learning app. It offers grounded lessons, Socratic chat, active recall, spaced repetition, Python exercises and progress insights. It runs entirely on your computer with your own AI provider. It has no account, no subscription to us, and no server to host.

## Install

The installer sets up everything the app needs, then builds the app for your computer. Each OS builds its own app; there is no prebuilt download yet.

**Windows 10 or 11 (64-bit):** download [install.cmd](https://github.com/aaronilyas/BridgeToGrowth-Learning/releases/download/installers/install.cmd) and double-click it. If SmartScreen warns about the downloaded file, choose **More info → Run anyway**. Or paste this into PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -c "irm https://raw.githubusercontent.com/aaronilyas/BridgeToGrowth-Learning/main/install.ps1 | iex"
```

**macOS or Linux:** paste this into a terminal:

```sh
curl -fsSL https://raw.githubusercontent.com/aaronilyas/BridgeToGrowth-Learning/main/install.sh | sh
```

Or download [install.sh](https://github.com/aaronilyas/BridgeToGrowth-Learning/releases/download/installers/install.sh) and run `sh ~/Downloads/install.sh`.

All three installers are also attached to the [Installers release](https://github.com/aaronilyas/BridgeToGrowth-Learning/releases/tag/installers), which `.github/workflows/installers.yml` refreshes whenever they change on `main`.

What the installer does:

| Step | Windows ([install.ps1](install.ps1)) | macOS / Linux ([install.sh](install.sh)) |
|---|---|---|
| System prerequisites | Microsoft Edge WebView2 runtime, if missing | Linux: GTK 3, WebKitGTK 4.1, libsoup 3, Ayatana AppIndicator 3, pkg-config, zstd, git, curl and unzip, via apt, dnf, pacman or zypper. It shows the command and asks before using `sudo`. macOS: nothing extra. |
| Bun | Installs Bun 1.4.4 if Bun 1.4 or newer is missing | same |
| Source | Uses the folder the script is in if it is a checkout. Otherwise it clones (or downloads a zip of) this repository into `%USERPROFILE%\BridgeToGrowth-Learning`, or updates an earlier copy there. | same, into `~/BridgeToGrowth-Learning` |
| Build | `bun install`, then `scripts/make-app.ts` | same |

The finished app lands in the `artifacts/` folder of the source folder. The installer prints the paths, and on Windows it opens the folder.

- **Windows:** the Electrobun installer in `artifacts\windows-x64\`. Builds are unsigned: if SmartScreen warns, choose **More info → Run anyway**.
- **macOS:** the Electrobun app archive in `artifacts/macos-<arch>/`. Builds are unsigned: open the app once with right-click → **Open**.
- **Linux x64:** `BridgeToGrowthLearning-x86_64.AppImage`, which runs as is, and a `.deb` you can add to the app menu with `sudo apt install ./artifacts/BridgeToGrowthLearning_*_amd64.deb`. Other Linux CPUs get the Electrobun archive in `artifacts/linux-<arch>/`.

Run the installer again to update: it pulls the latest source and rebuilds. Optional settings are environment variables. `BTG_DIR` sets where the source goes, `BTG_BRANCH` picks a branch, `BTG_YES=1` installs Linux packages without asking, and `BTG_SKIP_SYSTEM=1` skips the system package step.

If Bun is already installed and you are in a checkout, `./make-app.sh` (macOS, Linux) or `make-app.cmd` (Windows) runs only the build. `bun run package:linux` builds only the AppImage and .deb. There is no auto-update yet. See [docs/packaging.md](docs/packaging.md).

## How AI is paid for

On first launch the app asks you to connect at least one AI source. You can connect several and pick a default model for each task (lessons, chat, practice generation, and system work such as grading, extraction and insights).

| Source | How you connect | Who pays |
|---|---|---|
| OpenRouter | paste an API key | your OpenRouter account, per use. The app shows the reported cost and can enforce an optional monthly budget. |
| Codex | Settings → Connections → **Sign in with ChatGPT**. The app starts the official Codex CLI's own sign-in and shows a one-time code; you enter it on OpenAI's page. A browser sign-in is offered as a fallback. | your ChatGPT plan's usage limits. Install the CLI yourself (`npm install -g @openai/codex`); the app runs `codex exec` with every tool disabled. |
| SpaceXAI | paste an xAI API key (**Get a SpaceXAI key** opens the xAI console) | your xAI account, per use. xAI does not document subscription use in other apps, so only API keys are supported. |

The app never sees your ChatGPT password or Codex tokens: sign-in and sign-out run inside the official CLI, which keeps its own credentials. API keys are stored in your OS keychain (libsecret, macOS Keychain, or Windows Credential Manager). They are never written to the database, logs or exports. The Usage page shows tokens per provider and model for each month. USD cost appears only where the provider reports it, which is OpenRouter.

## Your data

Everything lives in one SQLite database in the OS app-data directory:

- Linux: `$XDG_DATA_HOME/bridgetogrowth` or `~/.local/share/bridgetogrowth`
- macOS: `~/Library/Application Support/BridgeToGrowth`
- Windows: `%APPDATA%\BridgeToGrowth`

Settings → Data exports a zip of the database. It can also delete all data and stored keys. Paper search uses OpenAlex. You can add a contact email for OpenAlex in Settings; it is optional.

## Python exercises

Code questions run in Pyodide inside the app window, offline, with an import allowlist and a time limit. The check is advisory: the code runs on your own machine, so a result is for self-assessment, not proof.

## Development

Prerequisites: Bun 1.4 or newer. On Linux the desktop window also needs GTK 3, WebKitGTK 4.1, libsoup 3 and Ayatana AppIndicator 3. `bun run desktop:dev` checks for them before it builds. If any are missing, it prints the install command for your distro and offers to run it. Run `bun run setup:linux` to do the check on its own.

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

## Further reading

- [docs/desktop-facts.md](docs/desktop-facts.md): verified facts about the Codex CLI, xAI, Bun and Electrobun that the design relies on, and the residual risks
- [docs/prompt-research.md](docs/prompt-research.md): the research behind the tutoring prompts
- [CLAUDE.md](CLAUDE.md): the contract for code changes
