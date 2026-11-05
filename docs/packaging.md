# Desktop packaging

BridgeToGrowth Learning ships as an Electrobun app. The window loads the Bun server on `127.0.0.1` at a random port. Electrobun 2.0.5 uses the system webview (WebKitGTK 4.1 on Linux) and does not emit an AppImage or a `.deb`. `scripts/package-linux.ts` wraps the Linux build.

## Build

One command builds for the current OS: `./make-app.sh` (macOS, Linux) or `make-app.cmd` (Windows). Both run `bun install --frozen-lockfile` and then `scripts/make-app.ts`, which checks the Bun version and Linux libraries, fetches the pinned Pyodide assets, runs the stable Electrobun build, wraps Linux x64 output as an AppImage and .deb, and copies the installer into `artifacts/<os>-<arch>/`. Electrobun cannot cross-compile, so each OS builds its own app.

The individual steps, from a checkout with Bun 1.4.4:

```sh
bun install --frozen-lockfile
bun run desktop:dev      # Bun main process, one window, reload on change
bun run desktop:build    # current platform, stable channel
bun run package:linux    # stable Linux build, then AppImage and .deb
bun run smoke            # headless /api/health: 200 with the token, 401 without
```

`desktop:dev` runs `scripts/desktop-dev.ts`. It builds `dist/`, starts `electrobun dev`, and on any change in `src/` or `desktop/*.ts` it rebuilds and restarts the window. It does not use `electrobun dev --watch`: in Hutch 0.28.2 that watcher rebuilds in an endless loop after the first change it sees, so the window keeps closing and reopening, and `watchIgnore` does not stop it.

Linux builds need GTK 3 and WebKitGTK 4.1 headers (`libgtk-3-dev`, `libwebkit2gtk-4.1-dev`). The icon is `desktop/icon.svg`, the same mark as the in-app logo, plus `desktop/icon.png` at 256×256.

`package:linux` downloads appimagetool 1.9.1, checks SHA-256 `ed4ce84f0d9caff66f50bcca6ff6f35aae54ce8135408b3fa33abfc3cb384eb0`, and caches it under `scripts/cache/appimagetool/` (gitignored). It runs the tool with `APPIMAGE_EXTRACT_AND_RUN=1`, so FUSE is not required to build. A `.deb` is built with `dpkg-deb` when that binary is on `PATH`. Otherwise the script writes an `ar` archive of `debian-binary`, `control.tar.gz`, and `data.tar.gz` itself.

## Artifacts

| File | Role |
|---|---|
| `artifacts/BridgeToGrowthLearning-x86_64.AppImage` | portable Linux build |
| `artifacts/BridgeToGrowthLearning_0.1.0_amd64.deb` | Debian package (`/opt/BridgeToGrowthLearning`, `/usr/bin/bridgetogrowth-learning`) |
| `desktop/build/`, `desktop/artifacts/` | Electrobun intermediates (gitignored) |

The `.deb` depends on `libgtk-3-0` (or `libgtk-3-0t64`) and `libwebkit2gtk-4.1-0`. Both packages install a `.desktop` entry named BridgeToGrowth Learning and the logo icon.

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
