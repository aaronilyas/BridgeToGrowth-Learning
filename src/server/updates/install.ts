import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, copyFile, mkdir, readdir, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { InstallKind, UpdateOutcome } from "../../shared/updates.ts";
import { APP_VERSION } from "../../shared/version.ts";
import { HttpError } from "../http.ts";
import { appDataDir } from "../paths.ts";
import { backupFileName, backupsToPrune, installKindOf } from "./core.ts";
import { snapshotDatabase } from "./sql.ts";

export type AppShell = { channel: string; quit: () => void; openPath: (path: string) => boolean; revealPath: (path: string) => void };

const KEEP_BACKUPS = 5;
const DEB_LAUNCHER = "/usr/bin/bridgetogrowth-learning";
const RELAUNCH_DELAY_S = 2;
const APPIMAGE_ENV = ["APPIMAGE", "APPDIR", "ARGV0", "OWD"];

// O(1)
// SEC: argv only, no shell; the path is one the app wrote itself
function openPathWithPlatform(path: string): boolean {
  const argv = process.platform === "darwin" ? ["open", path] : process.platform === "win32" ? ["explorer.exe", path] : ["xdg-open", path];
  const bin = Bun.which(argv[0] ?? "");
  if (bin === null) return false;
  Bun.spawn([bin, ...argv.slice(1)], { stdin: "ignore", stdout: "ignore", stderr: "ignore" });
  return true;
}

let shell: AppShell = {
  channel: "",
  quit: () => process.exit(0),
  openPath: openPathWithPlatform,
  revealPath: (path) => void openPathWithPlatform(dirname(path)),
};
let kind: InstallKind | null = null;

// O(1)
// INV: the desktop shell hands in its release channel and native quit, open and reveal once at startup; headless runs keep the defaults, whose empty channel means "none"
export function setAppShell(next: AppShell): void {
  shell = next;
  kind = null;
}

// O(1)
export function readAppShell(): AppShell {
  return shell;
}

// O(1)
// INV: computed once per shell; the Windows uninstaller sits one folder above bin\bun.exe
export function readInstallKind(): InstallKind {
  if (kind !== null) return kind;
  const appRoot = dirname(dirname(process.execPath));
  kind = installKindOf({
    platform: process.platform,
    arch: process.arch,
    channel: shell.channel,
    execPath: process.execPath,
    appImage: process.env.APPIMAGE,
    hasUninstaller: process.platform === "win32" && existsSync(join(appRoot, "unins000.exe")),
  });
  return kind;
}

// O(1)
export function updatesDir(): string {
  return join(appDataDir(), "updates");
}

// O(n) in the database size
// INV: every install first copies the database to backups/, so data written by this version survives a downgrade; only the newest KEEP_BACKUPS copies are kept
export async function backupBeforeInstall(now: Date = new Date()): Promise<string> {
  const dir = join(appDataDir(), "backups");
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, backupFileName(APP_VERSION, now));
  await snapshotDatabase(path);
  for (const name of backupsToPrune(await readdir(dir), KEEP_BACKUPS)) await rm(join(dir, name), { force: true });
  return path;
}

// O(1)
// INV: the child outlives this process, and an AppImage's own variables are dropped so the new copy sets them fresh
function spawnDetached(argv: string[]): void {
  const env: Record<string, string | undefined> = { ...process.env };
  for (const name of APPIMAGE_ENV) delete env[name];
  const [bin, ...args] = argv;
  if (bin === undefined) return;
  const child = spawn(bin, args, { detached: true, stdio: "ignore", env, windowsHide: false });
  child.unref();
}

// O(1)
// SEC: the target path is passed as $0, never spliced into the script
function relaunchLater(target: string): void {
  spawnDetached(["/bin/sh", "-c", `sleep ${RELAUNCH_DELAY_S}; exec "$0"`, target]);
}

// O(1)
// INV: pkexec exit 126 or 127 means the password prompt was dismissed or refused; any non-zero exit leaves the installed package as it was
async function installDeb(file: string): Promise<UpdateOutcome> {
  const pkexec = Bun.which("pkexec");
  const apt = Bun.which("apt-get");
  const dpkg = Bun.which("dpkg");
  if (pkexec === null || (apt === null && dpkg === null)) {
    shell.revealPath(file);
    return "revealed";
  }
  const argv = apt !== null ? [pkexec, apt, "install", "-y", "--allow-downgrades", file] : [pkexec, dpkg ?? "dpkg", "-i", file];
  const proc = Bun.spawn(argv, { stdin: "ignore", stdout: "ignore", stderr: "ignore" });
  if (await proc.exited !== 0) throw new HttpError(500, "update_install_failed");
  relaunchLater(DEB_LAUNCHER);
  return "quitting";
}

// O(n) in file size
// INV: the new image is copied beside the running one and renamed over it, so the swap is atomic and the running copy keeps its open file; a folder the user cannot write falls back to showing the download
async function installAppImage(file: string): Promise<UpdateOutcome> {
  const target = process.env.APPIMAGE;
  if (target === undefined) throw new HttpError(500, "update_install_failed");
  const staged = `${target}.update-${crypto.randomUUID()}`;
  try {
    await copyFile(file, staged);
    await chmod(staged, 0o755);
    await rename(staged, target);
  } catch {
    await rm(staged, { force: true });
    shell.revealPath(file);
    return "revealed";
  }
  relaunchLater(target);
  return "quitting";
}

// O(n) in file size for an AppImage, O(1) otherwise
// INV: Windows runs the setup wizard (same AppId, so it replaces the install in place at any version) and the app quits so its files are free; macOS opens the disk image for the drag into Applications
export async function runInstaller(installKind: InstallKind, file: string): Promise<UpdateOutcome> {
  if (installKind === "windows") {
    spawnDetached([file]);
    return "quitting";
  }
  if (installKind === "macos") {
    if (!shell.openPath(file)) throw new HttpError(500, "update_install_failed");
    return "opened";
  }
  if (installKind === "deb") return installDeb(file);
  if (installKind === "appimage") return installAppImage(file);
  shell.revealPath(file);
  return "revealed";
}
