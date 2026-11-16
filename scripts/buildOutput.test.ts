import { expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { moveSourceMaps, resetBuildDirs } from "./buildOutput.ts";

// O(files under dir)
async function listFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true }).catch(() => []);
  return entries.filter((e) => e.isFile()).map((e) => join(e.parentPath, e.name).slice(dir.length + 1)).sort();
}

test("a build starts from empty output and map folders", async () => {
  const root = await mkdtemp(join(tmpdir(), "btg-build-"));
  try {
    const out = join(root, "dist");
    const maps = join(root, "dist-maps");
    await Bun.write(join(out, "chunk-old.js"), "stale");
    await Bun.write(join(out, "pyodide", "old.whl"), "stale");
    await Bun.write(join(maps, "chunk-old.js.map"), "stale");
    await resetBuildDirs(out, maps);
    expect(await listFiles(out)).toEqual([]);
    expect(await listFiles(maps)).toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("source maps leave dist/ for the maps folder at the same relative path", async () => {
  const root = await mkdtemp(join(tmpdir(), "btg-build-"));
  try {
    const out = join(root, "dist");
    const maps = join(root, "dist-maps");
    await resetBuildDirs(out, maps);
    await Bun.write(join(out, "boot.js"), "//# sourceMappingURL=/boot.js.map");
    await Bun.write(join(out, "boot.js.map"), "{}");
    await Bun.write(join(out, "sub", "chunk-a.js.map"), "{}");
    await Bun.write(join(out, "chunk-a.css"), "a{}");
    const moved = await moveSourceMaps(out, maps);
    expect(moved.length).toBe(2);
    expect(await listFiles(out)).toEqual(["boot.js", "chunk-a.css"]);
    expect(await listFiles(maps)).toEqual(["boot.js.map", join("sub", "chunk-a.js.map")].sort());
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
