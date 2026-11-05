import { cp, mkdir, readdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const OUTPUT = join(ROOT, "artifacts");
const MIN_BUN: readonly [number, number] = [1, 4];

// O(1)
function platformLabel(): string {
  const os = process.platform === "darwin" ? "macos" : process.platform === "win32" ? "windows" : process.platform;
  return `${os}-${process.arch}`;
}

// O(1)
function failBuild(message: string): never {
  console.error(`\nmake-app: ${message}`);
  process.exit(1);
}

// O(1) in command output
async function runStep(title: string, argv: string[], cwd: string = ROOT): Promise<void> {
  console.log(`\n==> ${title}`);
  const proc = Bun.spawn(argv, { cwd, stdin: "inherit", stdout: "inherit", stderr: "inherit" });
  const code = await proc.exited;
  if (code !== 0) failBuild(`${title} failed (exit ${code}).`);
}

// O(1)
function checkBunVersion(): void {
  const [major = 0, minor = 0] = Bun.version.split(".").map(Number);
  if (major < MIN_BUN[0] || (major === MIN_BUN[0] && minor < MIN_BUN[1])) failBuild(`Bun ${MIN_BUN.join(".")} or newer is required (found ${Bun.version}). Run \`bun upgrade\`.`);
}

// O(1)
async function checkLinuxLibraries(): Promise<void> {
  if (process.platform !== "linux") return;
  const pkgConfig = Bun.which("pkg-config");
  if (pkgConfig === null) {
    console.warn("make-app: pkg-config not found, so GTK 3 and WebKitGTK 4.1 could not be checked.");
    return;
  }
  const missing: string[] = [];
  for (const lib of ["gtk+-3.0", "webkit2gtk-4.1"]) {
    const proc = Bun.spawn([pkgConfig, "--exists", lib], { stdout: "ignore", stderr: "ignore" });
    if (await proc.exited !== 0) missing.push(lib);
  }
  if (missing.length === 0) return;
  failBuild([
    `missing system libraries: ${missing.join(", ")}`,
    "  Debian/Ubuntu: sudo apt install libgtk-3-dev libwebkit2gtk-4.1-dev",
    "  Fedora:        sudo dnf install gtk3-devel webkit2gtk4.1-devel",
    "  Arch:          sudo pacman -S gtk3 webkit2gtk-4.1",
  ].join("\n"));
}

// O(n) in artifact count
async function collectElectrobunArtifacts(): Promise<string[]> {
  const source = join(ROOT, "desktop", "artifacts");
  const dest = join(OUTPUT, platformLabel());
  await rm(dest, { recursive: true, force: true });
  await mkdir(dest, { recursive: true });
  const copied: string[] = [];
  for (const entry of await readdir(source, { withFileTypes: true }).catch(() => [])) {
    if (!entry.isFile() || entry.name.endsWith("update.json")) continue;
    await cp(join(source, entry.name), join(dest, entry.name));
    copied.push(join(dest, entry.name));
  }
  if (copied.length === 0) failBuild("the desktop build finished but produced no files in desktop/artifacts.");
  return copied;
}

// O(n) in artifact count
async function listLinuxPackages(): Promise<string[]> {
  const entries = await readdir(OUTPUT, { withFileTypes: true }).catch(() => []);
  return entries.filter((entry) => entry.isFile() && /\.(AppImage|deb)$/.test(entry.name)).map((entry) => join(OUTPUT, entry.name));
}

// O(1) plus the build
async function makeApp(): Promise<void> {
  console.log(`Building BridgeToGrowth Learning for ${platformLabel()}`);
  checkBunVersion();
  await checkLinuxLibraries();
  await runStep("Fetching pinned Pyodide assets", [process.execPath, join("scripts", "fetch-pyodide.ts")]);
  await runStep("Building the backend and interface", [process.execPath, join("scripts", "build.ts")]);
  await rm(join(ROOT, "desktop", "artifacts"), { recursive: true, force: true });
  await runStep("Building the desktop app", [process.execPath, "x", "electrobun", "build", "--env=stable"], join(ROOT, "desktop"));
  const outputs = await collectElectrobunArtifacts();
  if (process.platform === "linux" && process.arch === "x64") {
    await runStep("Packaging AppImage and .deb", [process.execPath, join("scripts", "package-linux.ts")]);
    outputs.push(...await listLinuxPackages());
  }
  console.log("\nDone. Your app:");
  for (const path of outputs) console.log(`  ${path}`);
  if (process.platform === "darwin") console.log("\nThe app is unsigned: open it once with right-click > Open.");
  if (process.platform === "win32") console.log("\nThe app is unsigned: if SmartScreen warns, choose More info > Run anyway.");
}

await makeApp();
