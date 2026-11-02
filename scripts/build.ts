import type { BunPlugin } from "bun";
import tailwind from "bun-plugin-tailwind";
import { join } from "node:path";
import { copyPyodideAssets } from "./fetch-pyodide.ts";

const OUT_DIR = "dist";
const SERVER_ENTRY = join(OUT_DIR, "index.js");
const CHUNK_IMPORT = /(\bfrom\s*"|\bimport\(\s*")\/(chunk-[a-z0-9]+\.js)"/g;
const KATEX_CSS = /^katex\/dist\/katex\.min\.css$/;
const FONT_FACE = /@font-face\{[^}]*\}/g;
const INLINED_FONT = "url(data:font";

// INV: Bun inlines every CSS url() asset under 128 KiB as a data: URL, and neither `loader` nor any other Bun.build option changes that, so the KaTeX @font-face rules are dropped here and src/web/katexFonts.ts registers the same faces from hashed font files
// INV: the stripped stylesheet loads in its own namespace, so the Tailwind plugin's .css onLoad never sees it
const katexFontsAsFiles: BunPlugin = {
  name: "katex-fonts-as-files",
  setup(build) {
    build.onResolve({ filter: KATEX_CSS }, (args) => ({ path: Bun.resolveSync(args.path, args.resolveDir), namespace: "katex-css" }));
    build.onLoad({ filter: /.*/, namespace: "katex-css" }, async (args) => ({ contents: (await Bun.file(args.path).text()).replace(FONT_FACE, ""), loader: "css" }));
  },
};

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
  const queue = [SERVER_ENTRY];
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
// INV: the Tailwind plugin from bunfig [serve.static] applies only to the dev server, so the production build passes it explicitly
// INV: splitting is required for the lazy page and markdown imports in src/web to become separate chunks; without it Bun inlines them into the entry
async function buildApp(): Promise<number> {
  const out = await Bun.build({ entrypoints: ["src/server/index.ts"], outdir: OUT_DIR, target: "bun", splitting: true, minify: true, publicPath: "/", sourcemap: "linked", plugins: [katexFontsAsFiles, tailwind], define: { "process.env.NODE_ENV": JSON.stringify("production") } });
  for (const log of out.logs) console.error(log.message);
  if (!out.success) return 1;
  const inlined = await findInlinedFonts(out.outputs.map((o) => o.path));
  if (inlined.length > 0) {
    console.error(`inlined fonts remain in ${inlined.join(", ")}`);
    return 1;
  }
  if ((await relinkServerChunks()) !== 0) return 1;
  await copyPyodideAssets(join(OUT_DIR, "pyodide"));
  console.log(`built ${out.outputs.length} files into ${OUT_DIR}/`);
  return 0;
}

process.exit(await buildApp());
