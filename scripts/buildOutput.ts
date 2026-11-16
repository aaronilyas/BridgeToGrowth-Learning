import { mkdir, readdir, rename, rm } from "node:fs/promises";
import { dirname, join, relative } from "node:path";

// O(files in both folders)
// INV: a build starts from empty output and map folders, so dist/ holds only files the current build wrote and Electrobun's copy of dist/ carries nothing stale
export async function resetBuildDirs(outDir: string, mapsDir: string): Promise<void> {
  await rm(outDir, { recursive: true, force: true });
  await rm(mapsDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
}

// O(files in outDir)
// INV: every *.map under outDir moves to the same relative path under mapsDir, so the packaged app ships no source map while every build still produces them, named after the file each one describes
export async function moveSourceMaps(outDir: string, mapsDir: string): Promise<string[]> {
  const entries = await readdir(outDir, { recursive: true, withFileTypes: true });
  const moved: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".map")) continue;
    const from = join(entry.parentPath, entry.name);
    const to = join(mapsDir, relative(outDir, from));
    await mkdir(dirname(to), { recursive: true });
    await rename(from, to);
    moved.push(to);
  }
  return moved;
}
