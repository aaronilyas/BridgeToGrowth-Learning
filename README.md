# BridgeToGrowth Learning

BridgeToGrowth Learning is a desktop learning app. It offers grounded lessons, Socratic chat, active recall, spaced repetition, Python exercises and progress insights. It runs entirely on your computer with your own AI provider. It has no account, no subscription to us, and no server to host.

## Install

Download the installer for your computer from the [latest release](https://github.com/aaronilyas/BridgeToGrowth-Learning/releases/latest):

| Your computer | Download | How to install |
|---|---|---|
| Windows 10 or 11 (64-bit) | [BridgeToGrowthLearning-Setup-x64.exe](https://github.com/aaronilyas/BridgeToGrowth-Learning/releases/latest/download/BridgeToGrowthLearning-Setup-x64.exe) | Run it and follow the setup wizard. |
| macOS (Apple silicon) | [BridgeToGrowthLearning-macOS-arm64.dmg](https://github.com/aaronilyas/BridgeToGrowth-Learning/releases/latest/download/BridgeToGrowthLearning-macOS-arm64.dmg) | Open it and drag the app into Applications. |
| Ubuntu, Debian, Linux Mint (64-bit) | [BridgeToGrowthLearning-amd64.deb](https://github.com/aaronilyas/BridgeToGrowth-Learning/releases/latest/download/BridgeToGrowthLearning-amd64.deb) | Double-click it to open it in your software center, then choose Install. |
| Other Linux (64-bit) | [BridgeToGrowthLearning-x86_64.AppImage](https://github.com/aaronilyas/BridgeToGrowth-Learning/releases/latest/download/BridgeToGrowthLearning-x86_64.AppImage) | Portable, nothing to install. Mark it executable (right-click → Properties → Allow executing, or `chmod +x`), then double-click it. |

Nothing else needs to be installed first.
- **Windows:** the setup wizard adds a Start menu entry and an optional desktop shortcut. It also installs the Microsoft Edge WebView2 runtime if the computer lacks it (Windows 11 already has it). It asks whether to install for you only, which needs no administrator rights, or for everyone. Uninstall from **Settings → Apps**.
- **Linux .deb:** installs the app into the app menu and pulls in the GTK and WebKitGTK libraries the window uses. From a terminal: `sudo apt install ~/Downloads/BridgeToGrowthLearning-amd64.deb`. Remove it with your software center or `sudo apt remove bridgetogrowth-learning`.
- **Linux AppImage:** uses the WebKitGTK 4.1 libraries already on your system. If one is missing, it names the package to install.

The installers are not code-signed yet, so the first launch needs one extra confirmation:
- **Windows:** if SmartScreen says "Windows protected your PC", choose **More info → Run anyway**.
- **macOS:** if macOS says it cannot verify the app, choose **Done**. Then open **System Settings → Privacy & Security**, scroll down, and choose **Open Anyway** next to the app's name. On macOS 14 and earlier, right-click the app in Applications and choose **Open**.

Intel Macs, ARM Linux and other systems can build the app from source; see [Build the app](#build-the-app).

## How AI is paid for

On first launch the app asks you to connect at least one AI source. You can connect several and pick a default model for each task (lessons, chat, practice generation, and system work such as grading, extraction and insights).

| Source | How you connect | Who pays |
|---|---|---|
| OpenRouter | paste an API key | your OpenRouter account, per use. The app shows the reported cost and can enforce an optional monthly budget. |
| Codex | Settings → Connections → **Sign in with ChatGPT**. The app starts the official Codex CLI's own sign-in and shows a one-time code; you enter it on OpenAI's page. A browser sign-in is offered as a fallback. | your ChatGPT plan's usage limits. Install the CLI yourself (`npm install -g @openai/codex`); the app runs `codex exec` with every tool disabled. |
| SpaceXAI | paste an xAI API key (**Get a SpaceXAI key** opens the xAI console) | your xAI account, per use. xAI does not document subscription use in other apps, so only API keys are supported. |
| Claude | nothing in the app: install [Claude Code](https://github.com/anthropics/claude-code) and sign in to it yourself (`claude auth login`, or `/login` inside `claude`). Settings → Connections shows **Connected** once it is signed in. | the Claude plan Claude Code is signed in to. The app talks to Claude Code through the Agent Client Protocol (ACP) with every tool turned off. |

The app never sees your ChatGPT password or Codex tokens: sign-in and sign-out run inside the official CLI, which keeps its own credentials. For Claude the app never signs in or out at all; it only uses the session Claude Code already has. API keys are stored in your OS keychain (libsecret, macOS Keychain, or Windows Credential Manager). They are never written to the database, logs or exports. The Usage page shows tokens per provider and model for each month. USD cost appears only where the provider reports it, which is OpenRouter.

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

## Build the app

Install [Bun](https://bun.sh) 1.4 or newer, then run the script for your system from the project folder:

```sh
./make-app.sh        # macOS or Linux
make-app.cmd         # Windows (or double-click it)
```

The script builds the app and its installer for the computer it runs on, into `artifacts/`:
- **Windows:** the setup wizard, if [Inno Setup](https://jrsoftware.org/isinfo.php) 6.3 or newer is installed (`winget install JRSoftware.InnoSetup`).
- **macOS:** the disk image.
- **Linux x64:** the AppImage and .deb.

Each OS builds its own app, so build on each OS you want to ship. CI builds all three on every pull request. Linux also needs the GTK 3 and WebKitGTK 4.1 headers; the script names the packages if they are missing.

To publish a release, set the version in `desktop/electrobun.config.ts`, then push a matching tag (`git tag v0.1.0 && git push origin v0.1.0`). CI builds the three installers and attaches them to a GitHub Release, and the download links above always point at the newest one. There is no auto-update yet. See [docs/packaging.md](docs/packaging.md).

## Further reading

- [docs/desktop-facts.md](docs/desktop-facts.md): verified facts about the Codex CLI, xAI, Claude Code over ACP, Bun and Electrobun that the design relies on, and the residual risks
- [docs/prompt-research.md](docs/prompt-research.md): the research behind the tutoring prompts
- [CLAUDE.md](CLAUDE.md): the contract for code changes
