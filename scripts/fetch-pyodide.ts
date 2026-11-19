import { cp, mkdir } from "node:fs/promises";
import { join } from "node:path";

const RELEASE = "https://cdn.jsdelivr.net/pyodide/v314.0.7/full/";
const CACHE = ".cache/pyodide";
const PKG = "node_modules/pyodide";
const ROOTS = ["numpy", "scipy", "sympy", "mpmath", "matplotlib"] as const;

const CORE: readonly (readonly [string, string])[] = [
  ["pyodide.asm.wasm", "cc36e3cab04fdfc9a63ff13eb52eae2b911bf46c025cc7b281f394bd3de1d5e6"],
  ["python_stdlib.zip", "fa1957e5777068fc4f7437f96d860ae2fbe9c19732ba06c84e004ec16dd7dd7a"],
  ["pyodide.asm.mjs", "f7cdc8ece80678ceb712f8e65ebe6d3a83203a180c399865f49612a051693635"],
  ["pyodide-lock.json", "5dc2fc119108bc148c7457dc86e7675b5c87e1cafd420b9c34c1eaef7b36c010"],
];

// INV: every wheel in the closure of ROOTS is pinned here, copied from the pinned 314.0.7 lock (CORE above)
const WHEEL_SHA: Readonly<Record<string, string>> = {
  numpy: "a292c1f5d7d8a2208cd5e94fc467604c131cabcd2fc14fed6eefde121e7fabdf",
  scipy: "17ee329a957863516d1bb6a6aaa0c60576fac027e9cd3d43de27f58b5b599b50",
  sympy: "61ea8bb98049ba1c702ba3ad2607acb7ab94b9af0b6f97498741f50d3249f428",
  mpmath: "e5ebd537e74b9066341a5152e83b63ff2fc37a6388fa7351e766b6e4640f7eee",
  matplotlib: "722857932f8f62eac64f8439af15c94d427f9fb945f9590cd242805c983d2d54",
  contourpy: "0ac15ebf9f820d2d1c3526388aa2818b631cb6c4aae1682efd6b4cc12c1f302c",
  cycler: "8ee450085f15b47f78b034d60059af6a3649e98fa5dde073363437742cc0b4ea",
  six: "228c50f73aa7addf2c2ccf2979c256802a59ab69cad8152b31b9443cc8140f42",
  fonttools: "0d1516e073fd0a8d8e6d9af46417b6a26209a42518024a18f7085e72d2599605",
  kiwisolver: "47781998156721147c128a3c74547d5703e0e3cc454d8203e629339368308a93",
  packaging: "565acbbea54da30348b6d68b6a54373e6f777987db9f1db6966b4b3a5060d303",
  pillow: "e29838b7a756e4ee0f27a9cfa9a387ee0dfa2e9dd44be2dd595130b9f9d93ac3",
  pyparsing: "f0dd8225b5f8e945980b400bd465b4b90cb0498a2eede0d9dbea98372f6110c5",
  "python-dateutil": "9b13365edf9c188f570baf9c540bbb3029ada2a2dacb9694b3659941693ee9e5",
  pytz: "b8249d6450146e0b61e6d710dc02ebb35a904796c4c2f97fe87d4ac5872db36a",
};

type Wheel = { file_name: string; sha256: string; depends: string[] };

// O(n)
function digest(bytes: Uint8Array): string {
  return new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
}

// O(1)
function isLockRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

// O(1)
function readWheel(packages: Record<string, unknown>, name: string): Wheel {
  const pkg = packages[name];
  if (!isLockRecord(pkg) || typeof pkg.file_name !== "string" || typeof pkg.sha256 !== "string" || !Array.isArray(pkg.depends) || pkg.depends.some((d) => typeof d !== "string")) {
    throw new Error(`pyodide lock entry ${name} is unreadable`);
  }
  return { file_name: pkg.file_name, sha256: pkg.sha256, depends: pkg.depends.filter((d): d is string => typeof d === "string") };
}

// O(deps)
function closure(packages: Record<string, unknown>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const walk = (name: string): void => {
    if (seen.has(name)) return;
    seen.add(name);
    const pin = WHEEL_SHA[name];
    if (pin === undefined) throw new Error(`pyodide wheel ${name} has no pinned sha256`);
    const wheel = readWheel(packages, name);
    if (wheel.sha256 !== pin) throw new Error(`pyodide lock sha256 for ${name} does not match the pin`);
    for (const dep of wheel.depends) walk(dep);
    out.push(name);
  };
  for (const root of ROOTS) walk(root);
  if (out.includes("micropip")) throw new Error("pyodide wheel closure includes micropip");
  return out;
}

// O(lock)
function filterLock(raw: unknown): { info: unknown; packages: Record<string, unknown> } {
  if (!isLockRecord(raw) || !isLockRecord(raw.packages) || !("info" in raw)) throw new Error("pyodide lock is unreadable");
  const names = closure(raw.packages);
  const packages: Record<string, unknown> = {};
  for (const name of names) packages[name] = raw.packages[name];
  return { info: raw.info, packages };
}

// O(file)
async function verifyCore(name: string, sha256: string): Promise<Uint8Array> {
  const bytes = new Uint8Array(await Bun.file(join(PKG, name)).arrayBuffer());
  if (digest(bytes) !== sha256) throw new Error(`pyodide ${name} hash mismatch`);
  return bytes;
}

// O(file)
async function downloadWheel(file: string, sha256: string): Promise<void> {
  const dest = join(CACHE, file);
  if (await Bun.file(dest).exists()) {
    const have = digest(new Uint8Array(await Bun.file(dest).arrayBuffer()));
    if (have === sha256) return;
  }
  const res = await fetch(`${RELEASE}${file}`);
  if (!res.ok) throw new Error(`pyodide download failed for ${file}: ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (digest(bytes) !== sha256) throw new Error(`pyodide wheel ${file} hash mismatch`);
  await Bun.write(dest, bytes);
}

// O(wheels)
// INV: writes a gitignored cache of the pinned Pyodide 314.0.7 runtime plus the catalog wheels. The lock copy lists only that closure.
export async function stagePyodideAssets(): Promise<string[]> {
  await mkdir(CACHE, { recursive: true });
  const files: string[] = [];
  let lockBytes: Uint8Array | null = null;
  for (const [name, sha] of CORE) {
    const bytes = await verifyCore(name, sha);
    if (name === "pyodide-lock.json") lockBytes = bytes;
    else {
      await Bun.write(join(CACHE, name), bytes);
      files.push(name);
    }
  }
  if (!lockBytes) throw new Error("pyodide lock is missing");
  const filtered = filterLock(JSON.parse(new TextDecoder().decode(lockBytes)) as unknown);
  await Bun.write(join(CACHE, "pyodide-lock.json"), JSON.stringify(filtered));
  files.push("pyodide-lock.json");
  for (const name of Object.keys(filtered.packages)) {
    const wheel = readWheel(filtered.packages, name);
    await downloadWheel(wheel.file_name, wheel.sha256);
    files.push(wheel.file_name);
  }
  return files;
}

// O(files)
export async function copyPyodideAssets(dest: string): Promise<void> {
  await stagePyodideAssets();
  await cp(CACHE, dest, { recursive: true });
}

if (import.meta.main) {
  const files = await stagePyodideAssets();
  console.log(`staged ${files.length} pyodide files into ${CACHE}/`);
}
