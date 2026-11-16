import { expect, test } from "bun:test";

// Runs in its own process: the test runner shares one module registry across files, and other tests load pdf.ts eagerly.
const script = `
const unpdfLoaded = () => Object.keys(require.cache).filter((path) => path.includes("/node_modules/unpdf/")).length;
await import("./src/server/boot.ts");
const atBoot = unpdfLoaded();
const { loadUnpdf } = await import("./src/server/sources/pdf.ts");
const afterPdfModule = unpdfLoaded();
const [first, second] = await Promise.all([loadUnpdf(), loadUnpdf()]);
await first.getResolvedPDFJS();
console.log(JSON.stringify({ atBoot, afterPdfModule, afterRead: unpdfLoaded(), shared: first === second && first === (await loadUnpdf()) }));
`;

test("starting the server does not load unpdf or pdf.js; the first PDF read does, once", async () => {
  const proc = Bun.spawn(["bun", "-"], { stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  proc.stdin.write(script);
  await proc.stdin.end();
  const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  expect(code).toBe(0);
  const result = JSON.parse(out.trim().split("\n").at(-1) ?? "{}") as { atBoot: number; afterPdfModule: number; afterRead: number; shared: boolean };
  expect(result.atBoot).toBe(0);
  expect(result.afterPdfModule).toBe(0);
  expect(result.afterRead).toBeGreaterThan(0);
  expect(result.shared).toBe(true);
});
