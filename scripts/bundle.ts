// Finds the runnable app inside an Electrobun stable build, for the installer scripts.
//
// INV: a stable build folder holds only a self-extracting launcher and Resources/<hash>.tar.zst.
// The runnable app (launcher and bun side by side in bin/, plus Resources/main.js) is inside that
// archive. Installers ship the runnable app, so the program lives in the install folder and the
// uninstaller removes all of it.
import { chmod, mkdir, readdir, rm } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize, resolve, sep } from "node:path";

export const ROOT = resolve(import.meta.dir, "..");

// O(1)
export async function appVersion(): Promise<string> {
  const { electrobunConfig } = await import(join(ROOT, "desktop", "electrobun.config.ts"));
  return electrobunConfig.app.version;
}

// O(n) in the tree
async function walkDirs(roots: string[], visit: (dir: string) => Promise<boolean>): Promise<void> {
  const pending = [...roots];
  while (pending.length > 0) {
    const dir = pending.shift();
    if (!dir) continue;
    if (await visit(dir)) continue;
    for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (entry.isDirectory() && !entry.name.startsWith(".")) pending.push(join(dir, entry.name));
    }
  }
}

// O(1)
function octal(bytes: Uint8Array, start: number, length: number): number {
  const text = new TextDecoder().decode(bytes.subarray(start, start + length)).replace(/\0.*$/s, "").trim();
  return text === "" ? 0 : parseInt(text, 8);
}

// O(1)
function text(bytes: Uint8Array, start: number, length: number): string {
  return new TextDecoder().decode(bytes.subarray(start, start + length)).replace(/\0.*$/s, "");
}

// O(1). Refuses absolute paths and "..", so an archive cannot write outside dest.
function safeJoin(dest: string, path: string): string {
  const clean = normalize(path.replace(/^\.\//, ""));
  if (clean === "." || clean === "") return dest;
  if (isAbsolute(clean) || /^[A-Za-z]:/.test(clean) || clean.split(/[\\/]/).includes("..")) throw new Error(`unsafe path in archive: ${path}`);
  return join(dest, clean);
}

// O(n) in archive size. Reads ustar, pax and GNU long-name entries; Electrobun writes ustar.
export async function unpackTarZst(archive: string, dest: string): Promise<void> {
  const tar = Bun.zstdDecompressSync(new Uint8Array(await Bun.file(archive).arrayBuffer()));
  await rm(dest, { recursive: true, force: true });
  await mkdir(dest, { recursive: true });
  let offset = 0;
  let nextPath: string | null = null;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const size = octal(header, 124, 12);
    const type = String.fromCharCode(header[156] ?? 0);
    const body = tar.subarray(offset + 512, offset + 512 + size);
    offset += 512 + Math.ceil(size / 512) * 512;

    if (type === "x") {
      for (const record of new TextDecoder().decode(body).split("\n")) {
        const m = /^\d+ path=(.*)$/s.exec(record);
        if (m?.[1]) nextPath = m[1];
      }
      continue;
    }
    if (type === "L") { nextPath = text(body, 0, body.length); continue; }
    if (type === "g") continue;

    const prefix = text(header, 257, 5) === "ustar" ? text(header, 345, 155) : "";
    const path = nextPath ?? (prefix ? `${prefix}/${text(header, 0, 100)}` : text(header, 0, 100));
    nextPath = null;
    const target = safeJoin(dest, path);
    if (type === "5") { await mkdir(target, { recursive: true }); continue; }
    if (type !== "0" && type !== "\0") throw new Error(`unsupported entry type "${type}" for ${path} in ${archive}`);
    await mkdir(dirname(target), { recursive: true });
    await Bun.write(target, body);
    if (sep === "/") await chmod(target, octal(header, 100, 8) & 0o777);
  }
}

// O(n) in the tree. Returns the stable build's folder that holds bin/<launcher>, bin/<bun> and
// Resources/main.js, unpacking the build's archive into artifacts/runtime when needed.
export async function findRuntime(exe: string): Promise<string> {
  const isRuntime = async (dir: string): Promise<boolean> =>
    await Bun.file(join(dir, "bin", `launcher${exe}`)).exists() &&
    await Bun.file(join(dir, "bin", `bun${exe}`)).exists() &&
    await Bun.file(join(dir, "Resources", "main.js")).exists();
  // Dev builds sit beside stable ones in desktop/build and must never be packaged.
  const isStable = (path: string): boolean => /stable-/.test(path.slice(ROOT.length));

  const found: string[] = [];
  const roots = [join(ROOT, "desktop", "build"), join(ROOT, "desktop", "artifacts")];
  await walkDirs(roots, async (dir) => isStable(dir) && (await isRuntime(dir)) && found.push(dir) > 0);
  if (found.length > 0) return found[0] as string;

  const archives: string[] = [];
  await walkDirs(roots, async (dir) => {
    for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (entry.isFile() && entry.name.endsWith(".tar.zst") && isStable(join(dir, entry.name))) archives.push(join(dir, entry.name));
    }
    return false;
  });
  const unpacked = join(ROOT, "artifacts", "runtime");
  for (const archive of archives) {
    console.log(`Unpacking ${archive}`);
    await unpackTarZst(archive, unpacked);
    await walkDirs([unpacked], async (dir) => (await isRuntime(dir)) && found.push(dir) > 0);
    if (found.length > 0) return found[0] as string;
  }
  throw new Error(`no runnable app (bin/launcher${exe}, bin/bun${exe}, Resources/main.js) found under desktop/build or desktop/artifacts. Run the desktop build first.`);
}
