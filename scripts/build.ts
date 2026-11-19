import type { BunPlugin } from "bun";
import tailwind from "bun-plugin-tailwind";
import { dirname, join, resolve } from "node:path";
import { findSourceModuleUrls, moveSourceMaps, resetBuildDirs } from "./buildOutput.ts";
import { copyPyodideAssets } from "./fetch-pyodide.ts";

const OUT_DIR = "dist";
const MAPS_DIR = "dist-maps";
const SERVER_ENTRIES = [join(OUT_DIR, "index.js"), join(OUT_DIR, "boot.js")];
const CHUNK_IMPORT = /(\bfrom\s*"|\bimport\s*"|\bimport\(\s*")\/(chunk-[a-z0-9]+\.js)"/g;
const KATEX_CSS = /^katex\/dist\/katex\.min\.css$/;
const FONT_FACE = /@font-face\{[^}]*\}/g;
const INLINED_FONT = "url(data:font";

type BrowserWorker = { entry: string; name: string };

// INV: every module the renderer starts with new Worker(...) is listed here. Bun 1.4 leaves `new Worker(new URL("./file.ts", import.meta.url))` as a source path, which the production server answers with the HTML document, so each worker is compiled to browser JS and attached as a hashed file asset the HTML bundle serves. findSourceModuleUrls fails the build if one is missed.
const BROWSER_WORKERS: readonly BrowserWorker[] = [
  { entry: "src/web/graph/layoutWorker.ts", name: "layoutWorker" },
  { entry: "src/web/pyodide/worker.ts", name: "pythonWorker" },
];

// INV: Bun inlines every CSS url() asset under 128 KiB as a data: URL, and neither `loader` nor any other Bun.build option changes that, so the KaTeX @font-face rules are dropped here and src/web/katexFonts.ts registers the same faces from hashed font files
// INV: the stripped stylesheet loads in its own namespace, so the Tailwind plugin's .css onLoad never sees it
const katexFontsAsFiles: BunPlugin = {
  name: "katex-fonts-as-files",
  setup(build) {
    build.onResolve({ filter: KATEX_CSS }, (args) => ({ path: Bun.resolveSync(args.path, args.resolveDir), namespace: "katex-css" }));
    build.onLoad({ filter: /.*/, namespace: "katex-css" }, async (args) => ({ contents: (await Bun.file(args.path).text()).replace(FONT_FACE, ""), loader: "css" }));
  },
};

// O(1)
// INV: math is typeset by rehype-katex but styled by katex/dist/katex.min.css and the fonts in katexFonts.ts; two KaTeX versions disagree on class names (0.19 renamed .sizing to .katex-sizing), which drops subscript sizing and positioning, so the build fails unless both resolve to one copy (package.json "overrides"; an old install keeps a stale nested copy until node_modules is reinstalled)
function katexMismatch(): string | null {
  const app = Bun.resolveSync("katex/package.json", "src/web/components");
  const renderer = Bun.resolveSync("katex/package.json", dirname(Bun.resolveSync("rehype-katex", "src/web/components")));
  return app === renderer ? null : `rehype-katex uses ${renderer} but the app's KaTeX stylesheet comes from ${app}; reinstall node_modules`;
}

// O(total CSS size)
// INV: the build fails rather than ship the ~1.4 MB of data: fonts in the entry stylesheet again
async function findInlinedFonts(paths: string[]): Promise<string[]> {
  const css = paths.filter((p) => p.endsWith(".css"));
  const texts = await Promise.all(css.map((p) => Bun.file(p).text()));
  return css.filter((_, i) => texts[i]?.includes(INLINED_FONT));
}

// O(n) in the server chunk graph
// INV: splitting shares runtime chunks between the server and the browser, and publicPath "/" makes every chunk import a filesystem-absolute path. Those imports are rewritten to "./" through the whole graph the server loads. A browser module at /chunk-*.js resolves "./" to the same URL, and the embedded asset manifest is left untouched.
async function relinkServerChunks(): Promise<number> {
  const seen = new Set<string>();
  const queue = [...SERVER_ENTRIES];
  while (queue.length > 0) {
    const path = queue.pop();
    if (!path || seen.has(path)) continue;
    seen.add(path);
    const text = await Bun.file(path).text();
    const re = new RegExp(CHUNK_IMPORT.source, "g");
    const linked = [...text.matchAll(re)].map((m) => m[2] ?? "");
    for (const name of linked) queue.push(join(OUT_DIR, name));
    if (linked.length > 0) await Bun.write(path, text.replace(new RegExp(CHUNK_IMPORT.source, "g"), "$1./$2\""));
  }
  return 0;
}

// O(bundle size)
async function workerSource(entry: string): Promise<string | null> {
  const out = await Bun.build({ entrypoints: [entry], target: "browser", minify: true, splitting: false, define: { "process.env.NODE_ENV": JSON.stringify("production") } });
  for (const log of out.logs) console.error(log.message);
  if (!out.success) return null;
  const js = out.outputs.find((o) => o.path.endsWith(".js"));
  return js ? js.text() : null;
}

// O(1)
// INV: an import of a listed worker's source file (by resolved path, so two files both named worker.ts stay distinct) loads that worker's compiled JS as a file asset named <name>-<hash>.js
function workersAsFiles(compiled: ReadonlyMap<string, { name: string; contents: string }>): BunPlugin {
  return {
    name: "workers-as-files",
    setup(build) {
      build.onResolve({ filter: /^\.{1,2}\/.*\.ts$/ }, (args) => {
        const full = resolve(args.resolveDir, args.path);
        const hit = compiled.get(full);
        return hit ? { path: `${hit.name}.js`, namespace: "browser-worker" } : undefined;
      });
      build.onLoad({ filter: /.*/, namespace: "browser-worker" }, (args) => {
        const hit = [...compiled.values()].find((w) => `${w.name}.js` === args.path);
        return { contents: hit?.contents ?? "", loader: "file" };
      });
    },
  };
}

// O(n) in output paths
function missingWorkers(paths: string[]): string[] {
  const names = paths.map((p) => p.replace(/\\/g, "/").split("/").pop() ?? "");
  return BROWSER_WORKERS.filter((w) => !names.some((n) => new RegExp(`^${w.name}-[a-z0-9]+\\.js$`).test(n))).map((w) => w.entry);
}

// O(bundle size)
// INV: the Claude ACP agent runs as its own Bun process (src/server/llm/providers/claude.ts), so it is one unsplit file beside the server bundle; nothing from node_modules ships
async function buildClaudeAgent(): Promise<number> {
  const out = await Bun.build({ entrypoints: ["src/server/llm/providers/claudeAcpEntry.ts"], outdir: OUT_DIR, naming: "claude-acp.js", target: "bun", minify: true, define: { "process.env.NODE_ENV": JSON.stringify("production") } });
  for (const log of out.logs) console.error(log.message);
  return out.success ? 0 : 1;
}

// O(bundle size)
// INV: the Tailwind plugin from bunfig [serve.static] applies only to the dev server, so the production build passes it explicitly
// INV: boot.js is the entry the desktop shell imports at runtime, so the app ships this exact bundle rather than a second build of the renderer
// INV: splitting is required for the lazy page and markdown imports in src/web to become separate chunks; without it Bun inlines them into the entry
// INV: dist/ is emptied first and its source maps are external (no sourceMappingURL comment for the runtime to chase) and end in dist-maps/, so the folder Electrobun copies into the app holds only this build's runtime files
async function buildApp(): Promise<number> {
  const katex = katexMismatch();
  if (katex !== null) {
    console.error(katex);
    return 1;
  }
  await resetBuildDirs(OUT_DIR, MAPS_DIR);
  const compiled = new Map<string, { name: string; contents: string }>();
  for (const w of BROWSER_WORKERS) {
    const contents = await workerSource(w.entry);
    if (contents === null) return 1;
    compiled.set(resolve(w.entry), { name: w.name, contents });
  }
  const out = await Bun.build({ entrypoints: ["src/server/index.ts", "src/server/boot.ts"], outdir: OUT_DIR, target: "bun", splitting: true, minify: true, publicPath: "/", sourcemap: "external", plugins: [katexFontsAsFiles, workersAsFiles(compiled), tailwind], define: { "process.env.NODE_ENV": JSON.stringify("production") } });
  for (const log of out.logs) console.error(log.message);
  if (!out.success) return 1;
  const missing = missingWorkers(out.outputs.map((o) => o.path));
  if (missing.length > 0) {
    console.error(`workers were not emitted as their own files in dist/: ${missing.join(", ")}`);
    return 1;
  }
  const raw = await findSourceModuleUrls(out.outputs.map((o) => o.path));
  if (raw.length > 0) {
    console.error(`a TypeScript module URL survived into ${raw.join(", ")}; production cannot load it. Add the worker to BROWSER_WORKERS and import it with { type: "file" }`);
    return 1;
  }
  const inlined = await findInlinedFonts(out.outputs.map((o) => o.path));
  if (inlined.length > 0) {
    console.error(`inlined fonts remain in ${inlined.join(", ")}`);
    return 1;
  }
  if ((await relinkServerChunks()) !== 0) return 1;
  if ((await buildClaudeAgent()) !== 0) return 1;
  await copyPyodideAssets(join(OUT_DIR, "pyodide"));
  const maps = await moveSourceMaps(OUT_DIR, MAPS_DIR);
  console.log(`built ${out.outputs.length} files into ${OUT_DIR}/, ${maps.length} source maps into ${MAPS_DIR}/`);
  return 0;
}

process.exit(await buildApp());
