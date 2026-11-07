# Desktop packaging

BridgeToGrowth Learning ships as an Electrobun app. The window loads the Bun server on `127.0.0.1` at a random port. Electrobun 2.0.5 uses the system webview (WebKitGTK 4.1 on Linux) and does not emit an AppImage or a `.deb`. `scripts/package-linux.ts` wraps the Linux build.

## Build

One command builds for the current OS: `./make-app.sh` (macOS, Linux) or `make-app.cmd` (Windows). Both run `bun install --frozen-lockfile` and then `scripts/make-app.ts`, which checks the Bun version and Linux libraries, fetches the pinned Pyodide assets, runs the stable Electrobun build, copies Electrobun's own output into `artifacts/<os>-<arch>/`, and then builds that OS's installers into `artifacts/` (see Installers). Electrobun cannot cross-compile, so each OS builds its own app.

The individual steps, from a checkout with Bun 1.4.4:

```sh
bun install --frozen-lockfile
bun run desktop:dev      # Bun main process, one window, reload on change
bun run desktop:build    # current platform, stable channel
bun run package:linux    # stable Linux build, then AppImage and .deb
bun scripts/package-windows.ts  # after desktop:build on Windows: setup wizard
bun scripts/package-macos.ts    # after desktop:build on macOS: disk image
bun run smoke            # headless /api/health: 200 with the token, 401 without
```

`desktop:dev` runs `scripts/desktop-dev.ts`. It builds `dist/`, starts `electrobun dev`, and on any change in `src/` or `desktop/*.ts` it rebuilds and restarts the window. It does not use `electrobun dev --watch`: in Hutch 0.28.2 that watcher rebuilds in an endless loop after the first change it sees, so the window keeps closing and reopening, and `watchIgnore` does not stop it.

Linux builds need GTK 3 and WebKitGTK 4.1 headers (`libgtk-3-dev`, `libwebkit2gtk-4.1-dev`). Running the window also needs the runtime libraries that Electrobun's `libNativeWrapper.so` links against: `libgtk-3.so.0`, `libwebkit2gtk-4.1.so.0`, `libjavascriptcoregtk-4.1.so.0`, `libsoup-3.0.so.0` and `libayatana-appindicator3.so.1`. If one is missing, the launcher only reports `Failed to open native wrapper ... FileNotFound`. `scripts/linux-runtime.ts` checks them before `desktop:dev` starts. It is also available as `bun run setup:linux`. It detects Debian, Fedora, Arch and openSUSE families, picks package names that exist (for example `libgtk-3-0t64` on Ubuntu 24.04 and later), and installs them after a prompt. Set `BTG_SKIP_INSTALL_PROMPT=1` to only print the command, or `BTG_SKIP_RUNTIME_CHECK=1` to skip the check. The NEEDS list there must match `readelf -d libNativeWrapper.so` when Electrobun is upgraded. A built wrapper is also checked with `ldd`. The icon is `desktop/icon.svg`, the same mark as the in-app logo, plus `desktop/icon.png` at 256×256.

`package:linux` downloads appimagetool 1.9.1, checks SHA-256 `ed4ce84f0d9caff66f50bcca6ff6f35aae54ce8135408b3fa33abfc3cb384eb0`, and caches it under `scripts/cache/appimagetool/` (gitignored). It runs the tool with `APPIMAGE_EXTRACT_AND_RUN=1`, so FUSE is not required to build. A `.deb` is built with `dpkg-deb` when that binary is on `PATH`. Otherwise the script writes an `ar` archive of `debian-binary`, `control.tar.gz`, and `data.tar.gz` itself.

## Installers

`.github/workflows/desktop.yml` builds these on every push and pull request and keeps them as workflow artifacts. A pushed `v*` tag that matches `app.version` in `desktop/electrobun.config.ts` also publishes them as a GitHub Release. The README links to `releases/latest/download/<file>`, so the file names must not change. The download page in `website/` looks up these same names on the latest stable release and does not link a file that is missing.

| File | Built by | What it is |
|---|---|---|
| `BridgeToGrowthLearning-Setup-x64.exe` | `scripts/package-windows.ts` | Inno Setup wizard from `installer/windows-setup.iss` |
| `BridgeToGrowthLearning-macOS-arm64.dmg` | `scripts/package-macos.ts` | disk image with the app and an Applications link |
| `BridgeToGrowthLearning-amd64.deb` | `scripts/package-linux.ts` | the `.deb` below, renamed by CI |
| `BridgeToGrowthLearning-x86_64.AppImage` | `scripts/package-linux.ts` | the AppImage below |

A stable Electrobun build is a self-extractor: `bin/launcher` plus `Resources/<hash>.tar.zst`, which it unpacks into the user's profile on first launch. The Windows and Linux installers ship the runnable app from inside that archive instead (`bin/launcher`, `bin/bun`, `Resources/main.js`). So the program lives in the install folder, and uninstalling removes all of it. `scripts/bundle.ts` finds it and unpacks the archive with `Bun.zstdDecompressSync`, so no `zstd` tool is needed. WebView2 keeps its profile under `%LOCALAPPDATA%`, so a read-only Program Files install works. The macOS disk image ships Electrobun's `.app` as built, with an ad-hoc signature, because Apple silicon will not run unsigned code.

The Windows wizard runs per user by default, with no administrator prompt, and offers a per-machine install. It adds Start menu and optional desktop shortcuts and an uninstaller. If the WebView2 runtime is missing, it runs Microsoft's bootstrapper, which is bundled in the setup. `package-windows.ts` downloads that bootstrapper to `scripts/cache/webview2/` and accepts it only with a valid Authenticode signature from Microsoft Corporation. The check runs in Windows PowerShell 5.1, with `PSModulePath` removed from the child environment, and loads `Microsoft.PowerShell.Security` from `$PSHOME`. The desktop workflow's Windows step runs under PowerShell 7; without that, 5.1 inherits PowerShell 7's copy of the module, `Get-AuthenticodeSignature` does not load, and a good bootstrapper is reported as unsigned. The `AppId` GUID in the `.iss` lets a newer setup upgrade an older install in place. Never change it. CI installs Inno Setup with Chocolatey if the runner lacks it. `make-app.ts` skips the wizard with a note when Inno Setup is not installed.

## In-app updates and rollback

`src/server/updates/` lets an installed app move to any stable GitHub release, newer or older. The version lives in `src/shared/version.ts`. `desktop/electrobun.config.ts`, the `.deb` control file and the release job's tag check all read it from there, so a `.deb` always carries its real version and apt can tell an upgrade from a downgrade.

- **Releases:** `GET /api/updates/releases` asks `api.github.com/repos/<repo>/releases` (no credentials; cached for 10 minutes, because GitHub allows 60 unauthenticated calls an hour). It keeps releases that are not drafts or prereleases and whose tag is plain `vX.Y.Z`.
- **Download:** `POST /api/updates/download {tag}` fetches that release's asset for this machine into `updates/` in the app-data folder. The first URL must be this repository's `releases/download/` path on github.com. Redirects are followed by hand, and each hop must stay on `release-assets.githubusercontent.com` or `objects.githubusercontent.com`. The file is kept only if its byte count and SHA-256 match the asset's `size` and `digest` fields. A release asset without a `digest` is never downloaded.
- **Install:** `POST /api/updates/install {tag}` first writes `backups/btg-before-<version>-<time>.sqlite` (with `VACUUM INTO`, keeping five). Then it installs by kind:

| Kind | Detected by | Install |
|---|---|---|
| Windows | stable channel, `unins000.exe` beside `bin\` | runs the setup wizard detached, then quits. The fixed `AppId` lets any version replace the install. |
| macOS | stable channel on arm64 | opens the `.dmg`; the user drags the app into Applications |
| `.deb` | stable channel, running from `/opt/BridgeToGrowthLearning/` | `pkexec apt-get install -y --allow-downgrades <file>` (or `dpkg -i`), then relaunches `/usr/bin/bridgetogrowth-learning` and quits |
| AppImage | stable channel, `APPIMAGE` set | copies the new image beside `$APPIMAGE`, renames it over the old one, relaunches it and quits |
| none | dev builds, anything else | reveals the downloaded file in its folder |

The shell passes the channel (from `Resources/version.json`, read before the cwd changes) and Electrobun's `Utils.quit`, `openPath` and `showItemInFolder` into `startServer`. The migration runner skips applied migrations it does not know, so an older version opens a newer database. The backup is there for the cases where newer data does not suit older code. This updater is separate from Electrobun's own updater, which still waits for signed artifacts (see below).

`desktop/icon.ico` (16 to 256 px) and `desktop/icon.iconset/` (16 to 1024 px, with Apple's icon margin) are generated from `desktop/icon.svg` by `bun scripts/make-icons.ts`, which has its own small rasterizer. Run it after changing the SVG and commit the output.

## Artifacts

| File | Role |
|---|---|
| `artifacts/BridgeToGrowthLearning-x86_64.AppImage` | portable Linux build |
| `artifacts/BridgeToGrowthLearning_<version>_amd64.deb` | Debian package (`/opt/BridgeToGrowthLearning`, `/usr/bin/bridgetogrowth-learning`) |
| `desktop/build/`, `desktop/artifacts/` | Electrobun intermediates (gitignored) |

The `.deb` depends on `libgtk-3-0t64` (or `libgtk-3-0`), `libwebkit2gtk-4.1-0`, `libjavascriptcoregtk-4.1-0`, `libsoup-3.0-0` and `libayatana-appindicator3-1`, so `apt install ./BridgeToGrowthLearning_*.deb` pulls them in. The AppImage does not bundle WebKitGTK. Its `AppRun` checks the wrapper with `ldd` and names any missing libraries, on the terminal and with `notify-send`, instead of failing silently. Both packages install a `.desktop` entry named BridgeToGrowth Learning and the logo icon.

Launch an AppImage on a machine without FUSE with:

```sh
APPIMAGE_EXTRACT_AND_RUN=1 ./artifacts/BridgeToGrowthLearning-x86_64.AppImage
```

The process prints `BTG_URL=` for the loopback origin. It does not print the launch token.

## Unsigned builds

Code signing, notarization, and auto-update are not implemented. CI (`.github/workflows/desktop.yml`) builds the matrix and leaves those steps as TODOs.

- Linux: the AppImage and `.deb` are unsigned. Distros and browsers may warn. There is no AppImage update channel.
- macOS: Gatekeeper blocks an unsigned app. Users can open it once from the Finder context menu, or remove the quarantine attribute locally. There is no Developer ID signature and no notarization ticket.
- Windows: SmartScreen warns on an unsigned executable. There is no Authenticode signature.

## Wiring signing later

Keep the Electrobun build as the input. Signing wraps the finished artifact; it does not change the app.

- macOS: create a Developer ID Application certificate, import it in CI from a secret, then `codesign --deep --force --options runtime --sign "Developer ID Application: …"` the `.app`. Notarize with `xcrun notarytool submit --wait` using an App Store Connect API key, then `xcrun stapler staple`. The notarization TODO in the workflow is the place to add that.
- Windows: sign the executable with `signtool` or Azure Artifact Signing. The certificate stays in CI secrets. The code-signing TODO is the place to add that.
- Linux: optionally sign the `.deb` with `dpkg-sig` and publish an AppImage update descriptor. Neither is required to install the packages above.
- Auto-update: Electrobun ships an updater. Point it at a static channel (version, URL, and a signature) once a host and a signing key exist. Do not enable it until the artifacts are signed. The auto-update TODO in the workflow is the place to add that.
