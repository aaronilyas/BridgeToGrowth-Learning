export type TestMsg = { name: string; code: string };

export type RunMsg = {
  type: "run";
  code: string;
  libs: string[];
  tests: TestMsg[];
  guardDefs: boolean;
  indexURL: string;
  memoryBytes: number;
};

export type FetchProbeMsg = { type: "fetchprobe"; indexURL: string };

export type InMsg = RunMsg | FetchProbeMsg;

export type OutMsg =
  | { type: "ready" }
  | { type: "memory"; bytes: number }
  | { type: "result"; stdout: string; stderr: string; error: string | null; tests: { name: string; passed: boolean; error: string | null }[]; bytes: number }
  | { type: "error"; message: string }
  | { type: "fetchprobe"; fetch: string; jsFetch: string; pyfetch: string };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

// O(1)
export function parseIn(v: unknown): InMsg | null {
  if (!isRecord(v) || typeof v.type !== "string") return null;
  if (v.type === "fetchprobe" && typeof v.indexURL === "string") return { type: "fetchprobe", indexURL: v.indexURL };
  if (v.type !== "run" || typeof v.code !== "string" || typeof v.indexURL !== "string" || typeof v.memoryBytes !== "number" || typeof v.guardDefs !== "boolean" || !Array.isArray(v.libs) || !Array.isArray(v.tests)) return null;
  if (!v.libs.every((l) => typeof l === "string")) return null;
  const tests: TestMsg[] = [];
  for (const t of v.tests) {
    if (!isRecord(t) || typeof t.name !== "string" || typeof t.code !== "string") return null;
    tests.push({ name: t.name, code: t.code });
  }
  return { type: "run", code: v.code, libs: v.libs.filter((l): l is string => typeof l === "string"), tests, guardDefs: v.guardDefs, indexURL: v.indexURL, memoryBytes: v.memoryBytes };
}

// O(1)
export function parseOut(v: unknown): OutMsg | null {
  if (!isRecord(v) || typeof v.type !== "string") return null;
  if (v.type === "ready") return { type: "ready" };
  if (v.type === "memory" && typeof v.bytes === "number") return { type: "memory", bytes: v.bytes };
  if (v.type === "error" && typeof v.message === "string") return { type: "error", message: v.message };
  if (v.type === "fetchprobe" && typeof v.fetch === "string" && typeof v.jsFetch === "string" && typeof v.pyfetch === "string") return { type: "fetchprobe", fetch: v.fetch, jsFetch: v.jsFetch, pyfetch: v.pyfetch };
  if (v.type !== "result" || typeof v.stdout !== "string" || typeof v.stderr !== "string" || typeof v.bytes !== "number" || !Array.isArray(v.tests)) return null;
  if (v.error !== null && typeof v.error !== "string") return null;
  return { type: "result", stdout: v.stdout, stderr: v.stderr, error: v.error, tests: v.tests as { name: string; passed: boolean; error: string | null }[], bytes: v.bytes };
}
