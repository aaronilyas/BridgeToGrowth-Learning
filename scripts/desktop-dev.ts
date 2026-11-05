import { type ChildProcess, spawn } from "node:child_process";
import { type FSWatcher, watch } from "node:fs";
import { join } from "node:path";

// INV: Hutch 0.28.2 `electrobun dev --watch` restarts the app in an endless loop after the first change it sees, whatever watchIgnore says, so this runner owns watching and restarts instead
// INV: src/ is watched too, because the window loads the dist/ bundle and Hutch only watched desktop/
const ROOT = join(import.meta.dir, "..");
const DESKTOP = join(ROOT, "desktop");
const WATCHED: { dir: string; recursive: boolean; skip: RegExp }[] = [
  { dir: join(ROOT, "src"), recursive: true, skip: /\.test\.tsx?$/ },
  { dir: DESKTOP, recursive: false, skip: /^(?!.*\.ts$)/ },
];
const DEBOUNCE_MS = 300;

let app: ChildProcess | undefined;
let restarting = false;
let pending = false;
let timer: ReturnType<typeof setTimeout> | undefined;

// O(bundle size)
async function buildDist(): Promise<boolean> {
  const proc = spawn("bun", ["scripts/build.ts"], { cwd: ROOT, stdio: "inherit" });
  return (await new Promise<number | null>((resolve) => proc.on("exit", resolve))) === 0;
}

// O(1)
// INV: the app runs in its own process group so a restart stops Hutch, the launcher and the Bun main process together
function launchApp(): void {
  const child = spawn("bunx", ["electrobun", "dev"], { cwd: DESKTOP, stdio: "inherit", detached: true });
  app = child;
  child.on("exit", (code) => {
    if (app !== child) return;
    app = undefined;
    if (!restarting) process.exit(code ?? 0);
  });
}

// O(1)
async function stopApp(): Promise<void> {
  const child = app;
  if (!child?.pid || child.exitCode !== null) return;
  app = undefined;
  const exited = new Promise<void>((resolve) => child.on("exit", () => resolve()));
  process.kill(-child.pid, "SIGTERM");
  const timeout = setTimeout(() => child.pid && process.kill(-child.pid, "SIGKILL"), 5000);
  await exited;
  clearTimeout(timeout);
}

// O(bundle size)
// INV: changes that land during a rebuild queue one more rebuild instead of overlapping it
async function restart(): Promise<void> {
  if (restarting) {
    pending = true;
    return;
  }
  restarting = true;
  do {
    pending = false;
    console.log("[desktop-dev] change detected, rebuilding...");
    await stopApp();
    if (await buildDist()) launchApp();
    else console.error("[desktop-dev] build failed; waiting for the next change");
  } while (pending);
  restarting = false;
}

// O(1)
function onChange(skip: RegExp, file: string | null): void {
  if (file && skip.test(file)) return;
  clearTimeout(timer);
  timer = setTimeout(() => void restart(), DEBOUNCE_MS);
}

// O(1)
async function shutdown(): Promise<void> {
  restarting = true;
  await stopApp();
  process.exit(0);
}

if (!(await buildDist())) process.exit(1);
launchApp();
const watchers: FSWatcher[] = WATCHED.map(({ dir, recursive, skip }) => watch(dir, { recursive }, (_event, file) => onChange(skip, file)));
console.log(`[desktop-dev] watching ${watchers.length} folders for changes`);
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
