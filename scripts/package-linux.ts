import { chmod, cp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { gzipSync } from "node:zlib";

const APP_NAME = "BridgeToGrowthLearning";
const VERSION = "0.1.0";
const TOOL_URL = "https://github.com/AppImage/appimagetool/releases/download/1.9.1/appimagetool-x86_64.AppImage";
const TOOL_SHA256 = "ed4ce84f0d9caff66f50bcca6ff6f35aae54ce8135408b3fa33abfc3cb384eb0";
const ROOT = resolve(import.meta.dir, "..");
const OUTPUT = join(ROOT, "artifacts");
const encoder = new TextEncoder();

type TarEntry = { path: string; bytes: Uint8Array; mode: number; dir: boolean };

// O(1)
function putBytes(header: Uint8Array, offset: number, value: string, length: number): void {
  header.set(encoder.encode(value).subarray(0, length), offset);
}

// O(1)
function putOctal(header: Uint8Array, offset: number, length: number, value: number): void {
  const digits = length - 1;
  putBytes(header, offset, Math.max(0, value).toString(8).padStart(digits, "0").slice(-digits), digits);
  header[offset + digits] = 0;
}

// O(1)
function tarHeader(entry: TarEntry): Uint8Array {
  const header = new Uint8Array(512);
  let name = entry.path;
  let prefix = "";
  if (encoder.encode(name).byteLength > 100) {
    const split = name.lastIndexOf("/", 155);
    const rest = split > 0 ? name.slice(split + 1) : name;
    if (split < 1 || encoder.encode(rest).byteLength > 100 || encoder.encode(name.slice(0, split)).byteLength > 155) throw new Error(`tar path too long: ${name}`);
    prefix = name.slice(0, split);
    name = rest;
  }
  putBytes(header, 0, name, 100);
  putOctal(header, 100, 8, entry.mode);
  putOctal(header, 108, 8, 0);
  putOctal(header, 116, 8, 0);
  putOctal(header, 124, 12, entry.dir ? 0 : entry.bytes.byteLength);
  putOctal(header, 136, 12, 0);
  header.fill(32, 148, 156);
  header[156] = entry.dir ? 53 : 48;
  putBytes(header, 257, "ustar", 5);
  putBytes(header, 263, "00", 2);
  putBytes(header, 345, prefix, 155);
  let sum = 0;
  for (const byte of header) sum += byte;
  putBytes(header, 148, sum.toString(8).padStart(6, "0"), 6);
  header[154] = 0;
  header[155] = 32;
  return header;
}

// O(n) in archive size
function makeTar(entries: TarEntry[]): Uint8Array {
  const chunks: Uint8Array[] = [];
  for (const entry of entries) {
    chunks.push(tarHeader(entry));
    if (!entry.dir && entry.bytes.byteLength > 0) {
      chunks.push(entry.bytes);
      const padding = (512 - (entry.bytes.byteLength % 512)) % 512;
      if (padding > 0) chunks.push(new Uint8Array(padding));
    }
  }
  chunks.push(new Uint8Array(1024));
  return Buffer.concat(chunks);
}

// O(n) in archive size
function makeAr(members: Array<{ name: string; bytes: Uint8Array }>): Uint8Array {
  const chunks: Uint8Array[] = [encoder.encode("!<arch>\n")];
  for (const member of members) {
    const name = `${member.name}/`.padEnd(16, " ").slice(0, 16);
    const header = encoder.encode(`${name}${"0".padStart(12, " ")}${"0".padStart(6, " ")}${"0".padStart(6, " ")}${"100644".padStart(8, " ")}${String(member.bytes.byteLength).padStart(10, " ")}\x60\n`);
    if (header.byteLength !== 60) throw new Error("ar header must be 60 bytes");
    chunks.push(header, member.bytes);
    if (member.bytes.byteLength % 2 === 1) chunks.push(new Uint8Array([10]));
  }
  return Buffer.concat(chunks);
}

// O(1) in command output
async function runCommand(argv: string[], env: Record<string, string> = {}): Promise<void> {
  const proc = Bun.spawn(argv, { cwd: ROOT, env: { ...process.env, ...env }, stdout: "inherit", stderr: "inherit" });
  const code = await proc.exited;
  if (code !== 0) throw new Error(`${basename(argv[0] ?? "command")} failed with exit ${code}`);
}

// O(n) in file size
async function ensureAppImageTool(): Promise<string> {
  const dir = join(ROOT, "scripts", "cache", "appimagetool");
  await mkdir(dir, { recursive: true });
  const path = join(dir, "appimagetool-x86_64.AppImage");
  const cached = await Bun.file(path).exists() ? new Bun.CryptoHasher("sha256").update(await readFile(path)).digest("hex") : "";
  if (cached !== TOOL_SHA256) {
    const response = await fetch(TOOL_URL);
    if (!response.ok) throw new Error(`appimagetool download failed: ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const digest = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
    if (digest !== TOOL_SHA256) throw new Error(`appimagetool SHA-256 mismatch: ${digest}`);
    await Bun.write(path, bytes);
  }
  await chmod(path, 0o755);
  return path;
}

// O(1)
function isElf(bytes: Uint8Array): boolean {
  return bytes.byteLength >= 4 && bytes[0] === 0x7f && bytes[1] === 0x45 && bytes[2] === 0x4c && bytes[3] === 0x46;
}

// O(1)
function bundleRank(dir: string): number {
  const lower = dir.toLowerCase();
  return (lower.includes("bridgetogrowth") ? 2 : 0) + (lower.includes("stable") ? 1 : 0);
}

// O(1)
// INV: the runnable app has bun beside the launcher. The stable folder's top-level launcher is only a self-extractor.
async function isRuntime(dir: string): Promise<boolean> {
  const launcher = join(dir, "bin", "launcher");
  if (!await Bun.file(launcher).exists() || !await Bun.file(join(dir, "bin", "bun")).exists() || !await Bun.file(join(dir, "Resources", "main.js")).exists()) return false;
  return isElf(new Uint8Array(await Bun.file(launcher).slice(0, 4).arrayBuffer()));
}

// O(n) in the build tree
async function walkDirs(roots: string[], visit: (dir: string) => Promise<boolean>): Promise<void> {
  const pending = [...roots];
  while (pending.length > 0) {
    const dir = pending.shift();
    if (!dir) continue;
    if (await visit(dir)) continue;
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) if (entry.isDirectory() && !entry.name.startsWith(".")) pending.push(join(dir, entry.name));
  }
}

// O(n) in archive size
async function extractZst(zst: string, dest: string): Promise<void> {
  await rm(dest, { recursive: true, force: true });
  await mkdir(dest, { recursive: true });
  const proc = Bun.spawn(["tar", "-x", "--zstd", "-f", zst, "-C", dest], { cwd: ROOT, stdout: "inherit", stderr: "inherit" });
  if (await proc.exited !== 0) throw new Error(`tar failed to extract ${basename(zst)}`);
}

// O(n) in the build tree
async function findBundle(): Promise<{ dir: string; bin: string }> {
  const roots = [join(ROOT, "desktop", "artifacts"), join(ROOT, "desktop", "build")];
  const found: string[] = [];
  const takeRuntime = async (dir: string): Promise<boolean> => {
    if (!(await isRuntime(dir))) return false;
    found.push(dir);
    return true;
  };
  await walkDirs(roots, takeRuntime);
  if (found.length === 0) {
    const archives: string[] = [];
    await walkDirs(roots, async (dir) => {
      for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
        if (entry.isFile() && entry.name.endsWith(".tar.zst")) archives.push(join(dir, entry.name));
      }
      return false;
    });
    const dest = join(OUTPUT, "runtime");
    for (const archive of archives.sort((left, right) => bundleRank(right) - bundleRank(left))) {
      await extractZst(archive, dest);
      await walkDirs([dest], takeRuntime);
      if (found.length > 0) break;
    }
  }
  const best = found.sort((left, right) => bundleRank(right) - bundleRank(left))[0];
  if (!best) throw new Error("Electrobun Linux bundle was not found under desktop/build or desktop/artifacts");
  return { dir: best, bin: "bin/launcher" };
}

// O(n) in directory size
async function listTree(root: string): Promise<TarEntry[]> {
  const files: TarEntry[] = [];
  const dirs = new Set<string>(["."]);
  const visit = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      const rel = relative(root, path).split("\\").join("/");
      if (entry.isDirectory()) {
        dirs.add(`./${rel}`);
        await visit(path);
      } else if (entry.isFile() || entry.isSymbolicLink()) {
        const info = await stat(path);
        files.push({ path: `./${rel}`, bytes: await readFile(path), mode: info.mode & 0o777, dir: false });
      }
    }
  };
  await visit(root);
  const directories = [...dirs].sort().map((path): TarEntry => ({ path: path.endsWith("/") ? path : `${path}/`, bytes: new Uint8Array(), mode: 0o755, dir: true }));
  return [...directories, ...files];
}

// O(1)
function debControlText(): string {
  return `Package: bridgetogrowth-learning\nVersion: ${VERSION}\nSection: education\nPriority: optional\nArchitecture: amd64\nMaintainer: BridgeToGrowth <ops@example.com>\nDepends: libgtk-3-0t64 | libgtk-3-0, libwebkit2gtk-4.1-0, libjavascriptcoregtk-4.1-0, libsoup-3.0-0, libayatana-appindicator3-1\nDescription: BridgeToGrowth Learning desktop app\n Local lessons, practice, and a knowledge graph.\n`;
}

// O(n) in package size
async function writePureDeb(root: string, output: string): Promise<void> {
  const control = encoder.encode(debControlText());
  const controlTar = gzipSync(makeTar([{ path: "./control", bytes: control, mode: 0o644, dir: false }]));
  const dataTar = gzipSync(makeTar(await listTree(root)));
  await writeFile(output, makeAr([
    { name: "debian-binary", bytes: encoder.encode("2.0\n") },
    { name: "control.tar.gz", bytes: controlTar },
    { name: "data.tar.gz", bytes: dataTar },
  ]));
}

// O(n) in bundled assets
// INV: Electrobun starts bun with cwd set to bin/, and the HTML bundle looks up its ./ assets there
async function linkBundledAssets(root: string): Promise<void> {
  const assets = join(root, "Resources", "app", "bun");
  const bin = join(root, "bin");
  for (const entry of await readdir(assets, { withFileTypes: true }).catch(() => [])) {
    if (!entry.isFile()) continue;
    const dest = join(bin, entry.name);
    if (await Bun.file(dest).exists()) continue;
    await symlink(join("..", "Resources", "app", "bun", entry.name), dest);
  }
}

// O(n) in app bundle size
async function buildDeb(bundle: string, bin: string): Promise<string> {
  const root = join(OUTPUT, "deb-root");
  await rm(root, { recursive: true, force: true });
  const install = join(root, "opt", APP_NAME);
  await mkdir(dirname(install), { recursive: true });
  await cp(bundle, install, { recursive: true });
  await chmod(join(install, bin), 0o755);
  await linkBundledAssets(install);
  await mkdir(join(root, "usr", "bin"), { recursive: true });
  await writeFile(join(root, "usr", "bin", "bridgetogrowth-learning"), `#!/bin/sh\nexec /opt/${APP_NAME}/${bin} "$@"\n`, { mode: 0o755 });
  await mkdir(join(root, "usr", "share", "applications"), { recursive: true });
  await mkdir(join(root, "usr", "share", "icons", "hicolor", "scalable", "apps"), { recursive: true });
  await mkdir(join(root, "usr", "share", "icons", "hicolor", "256x256", "apps"), { recursive: true });
  const desktop = `[Desktop Entry]\nType=Application\nName=BridgeToGrowth Learning\nExec=bridgetogrowth-learning\nIcon=bridgetogrowth-learning\nCategories=Education;\nTerminal=false\nStartupWMClass=${APP_NAME}\n`;
  await writeFile(join(root, "usr", "share", "applications", "bridgetogrowth-learning.desktop"), desktop);
  await cp(join(ROOT, "desktop", "icon.svg"), join(root, "usr", "share", "icons", "hicolor", "scalable", "apps", "bridgetogrowth-learning.svg"));
  await cp(join(ROOT, "desktop", "icon.png"), join(root, "usr", "share", "icons", "hicolor", "256x256", "apps", "bridgetogrowth-learning.png"));
  const output = join(OUTPUT, `BridgeToGrowthLearning_${VERSION}_amd64.deb`);
  const dpkg = Bun.which("dpkg-deb");
  if (dpkg) {
    await mkdir(join(root, "DEBIAN"), { recursive: true });
    await writeFile(join(root, "DEBIAN", "control"), debControlText(), { mode: 0o644 });
    await runCommand([dpkg, "--build", "--root-owner-group", root, output]);
  } else await writePureDeb(root, output);
  return output;
}

// O(1)
// INV: an AppImage does not bundle WebKitGTK, so AppRun names the missing system libraries (terminal and desktop notification) instead of letting the launcher fail silently from a menu
function appRunScript(bin: string): string {
  const binDir = `$HERE/usr/lib/${APP_NAME}/${dirname(bin)}`;
  return `#!/bin/sh
HERE="$(dirname "$(readlink -f "$0")")"
WRAPPER="${binDir}/libNativeWrapper.so"
if [ -f "$WRAPPER" ] && command -v ldd >/dev/null 2>&1; then
  MISSING="$(LD_LIBRARY_PATH="${binDir}" ldd "$WRAPPER" 2>/dev/null | awk '/not found/ {print $1}' | tr '\\n' ' ')"
  if [ -n "$MISSING" ]; then
    MSG="BridgeToGrowth Learning needs these system libraries: $MISSING
Debian/Ubuntu: sudo apt install libgtk-3-0t64 libwebkit2gtk-4.1-0 libayatana-appindicator3-1
Fedora/RHEL:   sudo dnf install gtk3 webkit2gtk4.1 libayatana-appindicator-gtk3
Arch/Manjaro:  sudo pacman -S gtk3 webkit2gtk-4.1 libayatana-appindicator"
    echo "$MSG" >&2
    command -v notify-send >/dev/null 2>&1 && notify-send "BridgeToGrowth Learning cannot start" "$MSG" 2>/dev/null
    exit 1
  fi
fi
exec "$HERE/usr/lib/${APP_NAME}/${bin}" "$@"
`;
}

// O(n) in app bundle size
async function packageLinux(): Promise<void> {
  await mkdir(OUTPUT, { recursive: true });
  const { dir, bin } = await findBundle();
  const appDir = join(OUTPUT, `${APP_NAME}.AppDir`);
  await rm(appDir, { recursive: true, force: true });
  const payload = join(appDir, "usr", "lib", APP_NAME);
  await mkdir(dirname(payload), { recursive: true });
  await cp(dir, payload, { recursive: true });
  await chmod(join(payload, bin), 0o755);
  await linkBundledAssets(payload);
  await cp(join(ROOT, "desktop", "icon.svg"), join(appDir, "bridgetogrowth-learning.svg"));
  await cp(join(ROOT, "desktop", "icon.png"), join(appDir, "bridgetogrowth-learning.png"));
  const desktop = `[Desktop Entry]\nType=Application\nName=BridgeToGrowth Learning\nExec=AppRun\nIcon=bridgetogrowth-learning\nCategories=Education;\nTerminal=false\nStartupWMClass=${APP_NAME}\n`;
  await writeFile(join(appDir, "bridgetogrowth-learning.desktop"), desktop, { mode: 0o755 });
  await writeFile(join(appDir, "AppRun"), appRunScript(bin), { mode: 0o755 });
  const tool = await ensureAppImageTool();
  const image = join(OUTPUT, `${APP_NAME}-x86_64.AppImage`);
  await runCommand([tool, appDir, image], { ARCH: "x86_64", APPIMAGE_EXTRACT_AND_RUN: "1" });
  await chmod(image, 0o755);
  const deb = await buildDeb(dir, bin);
  console.log(`created ${image}`);
  console.log(`created ${deb}`);
}

await packageLinux();
