import { loadPyodide, type PyodideAPI } from "pyodide";
import createPyodideModule from "pyodide/pyodide.asm.mjs";
import { PYODIDE_WHEELS } from "../../shared/code.ts";
import { HARNESS_PY } from "./harness.ts";
import { allowAssetFetch, blockAllNetwork } from "./net.ts";
import { parseIn, type RunMsg } from "./protocol.ts";

const WHEELS: ReadonlySet<string> = new Set(PYODIDE_WHEELS);
const HARNESS = `${HARNESS_PY}\nimport json\njson.dumps(run_payload(PAYLOAD_JSON))\n`;
const DROP_NET_MODULES = `import sys\nfor _name in ("micropip", "pyodide.http", "pyodide.ffi"):\n    sys.modules.pop(_name, None)\n`;

// O(1)
function textOf(e: unknown): string {
  return e instanceof Error ? e.message : "failed";
}

// O(1)
function heapBytes(py: object): number {
  if (!("_module" in py)) return 0;
  const mod = py._module;
  if (typeof mod !== "object" || mod === null || !("HEAP8" in mod)) return 0;
  const heap = mod.HEAP8;
  return heap instanceof Uint8Array ? heap.length : 0;
}

// O(1)
async function usedBytes(py: object): Promise<number> {
  const heap = heapBytes(py);
  const measure = (performance as Performance & { measureUserAgentSpecificMemory?: () => Promise<{ bytes: number }> }).measureUserAgentSpecificMemory;
  if (typeof measure !== "function") return heap;
  try {
    const measured = await measure.call(performance);
    if (typeof measured.bytes !== "number" || !Number.isFinite(measured.bytes)) return heap;
    // INV: this API can report the whole page. Ignore a figure far above the Pyodide heap so a quiet run is not stopped.
    if (measured.bytes > heap * 4 && measured.bytes > heap + 64 * 1024 * 1024) return heap;
    return Math.max(heap, measured.bytes);
  } catch {
    return heap;
  }
}

// O(1)
function setGlobal(py: PyodideAPI, key: string, value: string): void {
  const globals: unknown = py.globals;
  if (typeof globals !== "object" || globals === null || !("set" in globals)) throw new Error("Python failed to start.");
  const set: unknown = globals.set;
  if (typeof set !== "function") throw new Error("Python failed to start.");
  Reflect.apply(set, globals, [key, value]);
}

// O(wheels)
// SEC: wheels come only from the question allowlist intersected with PYODIDE_WHEELS. micropip is never requested. After this returns, network APIs throw.
async function boot(indexURL: string, wheels: readonly string[]): Promise<PyodideAPI> {
  if (indexURL.startsWith("http://") || indexURL.startsWith("https://")) allowAssetFetch(indexURL);
  const py = await loadPyodide({
    indexURL,
    packageBaseUrl: indexURL,
    cdnUrl: indexURL,
    lockFileURL: `${indexURL}pyodide-lock.json`,
    stdLibURL: `${indexURL}python_stdlib.zip`,
    createPyodideModule,
    packages: wheels.filter((name) => WHEELS.has(name)),
    checkAPIVersion: true,
    stdout: () => undefined,
    stderr: () => undefined,
    jsglobals: globalThis,
  });
  blockAllNetwork();
  py.runPython(DROP_NET_MODULES);
  return py;
}

// O(1)
async function pythonText(py: PyodideAPI, source: string): Promise<string> {
  const raw: unknown = await py.runPythonAsync(source);
  return typeof raw === "string" ? raw : "failed";
}

// O(1)
async function probeFetch(indexURL: string): Promise<void> {
  const py = await boot(indexURL, []);
  let fetchError = "allowed";
  try {
    await globalThis.fetch("https://example.com");
  } catch (e) {
    fetchError = textOf(e);
  }
  const jsFetch = await pythonText(py, String.raw`
import js
try:
    js.fetch("https://example.com")
    out = "allowed"
except BaseException as e:
    out = type(e).__name__ + ": " + str(e)
out
`);
  const pyfetch = await pythonText(py, String.raw`
import pyodide.http
try:
    await pyodide.http.pyfetch("https://example.com")
    out = "allowed"
except BaseException as e:
    out = type(e).__name__ + ": " + str(e)
out
`);
  postMessage({ type: "fetchprobe", fetch: fetchError, jsFetch, pyfetch });
}

// O(code + output)
async function runUser(py: PyodideAPI, msg: RunMsg): Promise<void> {
  const timer = setInterval(() => void usedBytes(py).then((bytes) => postMessage({ type: "memory", bytes })), 100);
  try {
    postMessage({ type: "ready" });
    setGlobal(py, "PAYLOAD_JSON", JSON.stringify({ libs: msg.libs, code: msg.code, tests: msg.tests, guardDefs: msg.guardDefs }));
    const raw: unknown = py.runPython(HARNESS);
    const parsed: unknown = JSON.parse(typeof raw === "string" ? raw : "");
    const body = typeof parsed === "object" && parsed !== null ? parsed : {};
    const rec = body as { stdout?: unknown; stderr?: unknown; error?: unknown; tests?: unknown };
    postMessage({
      type: "result",
      stdout: typeof rec.stdout === "string" ? rec.stdout : "",
      stderr: typeof rec.stderr === "string" ? rec.stderr : "",
      error: typeof rec.error === "string" || rec.error === null ? rec.error : "Python failed to start.",
      tests: rec.tests,
      bytes: await usedBytes(py),
    });
  } finally {
    clearInterval(timer);
  }
}

self.onmessage = (ev: MessageEvent<unknown>): void => {
  const msg = parseIn(ev.data);
  if (!msg) return;
  const task = msg.type === "fetchprobe" ? probeFetch(msg.indexURL) : boot(msg.indexURL, msg.libs).then((py) => runUser(py, msg));
  task.catch((e: unknown) => postMessage({ type: "error", message: textOf(e).slice(0, 300) }));
};
