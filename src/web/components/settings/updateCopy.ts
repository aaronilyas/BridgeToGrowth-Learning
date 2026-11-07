import type { InstallKind, UpdateOutcome } from "../../../shared/updates.ts";
import { describeError, isApiError } from "../../api.ts";

const KIND_TEXT: Record<InstallKind, string> = {
  windows: "Installed with the Windows setup wizard.",
  macos: "Installed from the macOS disk image.",
  deb: "Installed from the .deb package.",
  appimage: "Running from an AppImage.",
  none: "This copy is a development build, or was not installed by a release installer, so it can download a release but cannot install it. The download opens in a folder for you to install by hand.",
};

const INSTALL_LABEL: Record<InstallKind, string> = {
  windows: "Install and restart",
  macos: "Open disk image",
  deb: "Install and restart",
  appimage: "Replace and restart",
  none: "Show in folder",
};

const INSTALL_HINT: Record<InstallKind, string> = {
  windows: "The setup wizard opens and this app closes. Finish the wizard to start the new version.",
  macos: "The disk image opens in Finder. You drag the app into Applications.",
  deb: "Your system asks for your password to install the package, then the app restarts.",
  appimage: "The AppImage file is replaced in place, then the app restarts.",
  none: "",
};

// O(1)
export function describeInstallKind(kind: InstallKind): string {
  return KIND_TEXT[kind];
}

// O(1)
export function installLabelOf(kind: InstallKind): string {
  return INSTALL_LABEL[kind];
}

// O(1)
export function installHintOf(kind: InstallKind): string {
  return INSTALL_HINT[kind];
}

// O(1)
export function describeOutcome(kind: InstallKind, outcome: UpdateOutcome, version: string): string {
  if (outcome === "quitting") {
    return kind === "windows" ? `The setup wizard is open, and this app is closing. Finish the wizard to start version ${version}.` : `Version ${version} is installed. The app restarts in a moment.`;
  }
  if (outcome === "opened") return "The disk image is open. Quit BridgeToGrowth Learning, drag it onto Applications, choose Replace, then open it again.";
  if (kind === "deb") return "The package is in the folder that just opened. Install it from a terminal with sudo apt install --allow-downgrades and the file's path, or open it in your software center.";
  if (kind === "appimage") return "The app could not replace its AppImage file (the folder is read-only), so the new file is in the folder that just opened. Mark it executable and run it.";
  return "The installer is in the folder that just opened.";
}

// O(1)
// INV: an upstream error here means GitHub, not an AI provider
export function describeUpdateError(cause: unknown): string {
  if (isApiError(cause) && cause.code === "upstream") return "Couldn't reach GitHub. Check your connection, or try again in a few minutes: GitHub limits how often the app can ask.";
  return describeError(cause);
}

// O(1)
export function formatMegabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// O(1)
export function formatReleaseDate(iso: string | null): string {
  if (iso === null) return "";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
