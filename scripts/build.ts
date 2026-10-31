import tailwind from "bun-plugin-tailwind";

// O(bundle size)
// INV: the Tailwind plugin from bunfig [serve.static] applies only to the dev server, so the production build passes it explicitly
async function buildApp(): Promise<number> {
  const out = await Bun.build({ entrypoints: ["src/server/index.ts"], outdir: "dist", target: "bun", minify: true, publicPath: "/", sourcemap: "linked", plugins: [tailwind], define: { "process.env.NODE_ENV": JSON.stringify("production") } });
  for (const log of out.logs) console.error(log.message);
  if (!out.success) return 1;
  console.log(`built ${out.outputs.length} files into dist/`);
  return 0;
}

process.exit(await buildApp());
