import { expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findSourceModuleUrls, moveSourceMaps, resetBuildDirs } from "./buildOutput.ts";

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

test("a bundle that still builds a URL to a TypeScript module is reported", async () => {
  const root = await mkdtemp(join(tmpdir(), "btg-build-"));
  try {
    const raw = join(root, "chunk-raw.js");
    const raw2 = join(root, "chunk-raw2.js");
    const built = join(root, "chunk-ok.js");
    const css = join(root, "chunk-a.css");
    await Bun.write(raw, 'var w=new Worker(new URL("./worker.ts",import.meta.url),{type:"module"});');
    await Bun.write(raw2, "var u=new URL( './graph/layoutWorker.tsx' , import.meta.url );");
    await Bun.write(built, 'var w=new Worker("/pythonWorker-ab12cd34.js",{type:"module"});var p=new URL("./pyodide/",import.meta.url);');
    await Bun.write(css, 'a{background:url("./x.ts")}');
    expect(await findSourceModuleUrls([raw, raw2, built, css])).toEqual([raw, raw2]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
