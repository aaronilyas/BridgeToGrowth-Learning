import { existsSync } from "node:fs";
import { join } from "node:path";

const FILE_NAME = /^\/pyodide\/([A-Za-z0-9._-]+)$/;
const MIME: Record<string, string> = {
  wasm: "application/wasm",
  json: "application/json",
  mjs: "text/javascript",
  js: "text/javascript",
  zip: "application/octet-stream",
  whl: "application/octet-stream",
};

// O(1)
function assetDir(): string {
  const beside = join(import.meta.dir, "pyodide");
  if (existsSync(join(beside, "pyodide.asm.wasm"))) return beside;
  const cache = join(process.cwd(), ".cache", "pyodide");
  if (existsSync(join(cache, "pyodide.asm.wasm"))) return cache;
  return join(process.cwd(), "node_modules", "pyodide");
}

// O(1)
// SEC: one path segment, no parent references. The file is read only from the Pyodide asset directory.
export async function readPyodideAsset(pathname: string, method: string): Promise<Response | null> {
  if (method !== "GET" && method !== "HEAD") return null;
  const name = FILE_NAME.exec(pathname)?.[1];
  if (!name || name.startsWith(".") || name.includes("..")) return null;
  const file = Bun.file(join(assetDir(), name));
  if (!(await file.exists())) return new Response(null, { status: 404, headers: { "cache-control": "no-store" } });
  const ext = name.slice(name.lastIndexOf(".") + 1);
  const headers = { "content-type": MIME[ext] ?? "application/octet-stream", "cache-control": "public, max-age=86400" };
  if (method === "HEAD") return new Response(null, { status: 200, headers });
  return new Response(file, { status: 200, headers });
}
