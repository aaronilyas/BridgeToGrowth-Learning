import tailwind from "bun-plugin-tailwind";
import { join } from "node:path";

const OUT_DIR = "dist";
const SERVER_ENTRY = join(OUT_DIR, "index.js");
const CHUNK_IMPORT = /(\bfrom\s*"|\bimport\(\s*")\/(chunk-[a-z0-9]+\.js)"/g;
const HAS_CHUNK_IMPORT = new RegExp(CHUNK_IMPORT.source);

// O(n) in server entry size
// INV: splitting shares Bun's runtime-helper chunk between the server and the browser, and publicPath "/" makes the server's import of it a filesystem-absolute path; only the server entry's own chunk imports become "./", so the browser output and the embedded asset manifest stay exactly as Bun wrote them
// INV: a chunk the server imports must not import further chunks, since those imports would stay "/"-absolute; the build fails instead of shipping a server that cannot boot
async function relinkServerChunks(): Promise<number> {
  const text = await Bun.file(SERVER_ENTRY).text();
  const linked = [...text.matchAll(CHUNK_IMPORT)].map((m) => m[2] ?? "");
  for (const name of linked) {
    if (HAS_CHUNK_IMPORT.test(await Bun.file(join(OUT_DIR, name)).text())) {
      console.error(`server chunk ${name} imports another chunk`);
      return 1;
    }
  }
  await Bun.write(SERVER_ENTRY, text.replace(CHUNK_IMPORT, "$1./$2\""));
  return 0;
}

// O(bundle size)
// INV: the Tailwind plugin from bunfig [serve.static] applies only to the dev server, so the production build passes it explicitly
// INV: splitting is required for the lazy page and markdown imports in src/web to become separate chunks; without it Bun inlines them into the entry
async function buildApp(): Promise<number> {
  const out = await Bun.build({ entrypoints: ["src/server/index.ts"], outdir: OUT_DIR, target: "bun", splitting: true, minify: true, publicPath: "/", sourcemap: "linked", plugins: [tailwind], define: { "process.env.NODE_ENV": JSON.stringify("production") } });
  for (const log of out.logs) console.error(log.message);
  if (!out.success) return 1;
  if ((await relinkServerChunks()) !== 0) return 1;
  console.log(`built ${out.outputs.length} files into ${OUT_DIR}/`);
  return 0;
}

process.exit(await buildApp());
