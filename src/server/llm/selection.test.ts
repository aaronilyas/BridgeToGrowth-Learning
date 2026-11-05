import { expect, test } from "bun:test";

// INV: settings start empty, the state of a fresh install where a provider is connected but no Settings defaults were saved
const script = `
const { bootTestServer } = await import("./src/server/testkit.ts");
await bootTestServer();
const { z } = await import("zod");
const { HttpError } = await import("./src/server/http.ts");
const { LOCAL_USER_ID } = await import("./src/server/profile.ts");
const { Settings } = await import("./src/shared/settings.ts");
const { chatJson } = await import("./src/server/llm/gateway.ts");
const { installProviderForTest } = await import("./src/server/llm/providers/registry.ts");
const { updateSettings } = await import("./src/server/learn/sql.ts");

const Out = z.strictObject({ answer: z.string() });
const ref = (id) => ({ provider: "spacexai", id, label: id, vision: false, structured: "prompted", reasoning: [], contextTokens: 1000 });
let connected = true;
const seen = [];
installProviderForTest("spacexai", {
  id: "spacexai",
  auth: "subscription",
  status: async () => ({ provider: "spacexai", auth: "subscription", connected, detail: connected ? "ok" : "logged_out" }),
  listModels: async () => [ref("first"), ref("second"), ref("third")],
  stream: (req) => {
    seen.push(req.model.id);
    return (async function* () {
      yield { type: "text", delta: '{"answer":"ok"}' };
      yield { type: "done" };
    })();
  },
});
for (const id of ["openrouter", "codex"]) {
  installProviderForTest(id, { id, auth: "api_key", status: async () => ({ provider: id, auth: "api_key", connected: false, detail: "key_invalid" }), listModels: async () => [], stream: () => (async function* () {})() });
}

async function run(model, kind = "lesson") {
  try {
    const r = await chatJson({ who: { uid: LOCAL_USER_ID }, model, kind, system: "s", user: "u", schema: Out, maxTokens: 20 });
    return r.modelId;
  } catch (error) {
    return error instanceof HttpError ? "err:" + error.code : "err:other";
  }
}

await updateSettings(LOCAL_USER_ID, Settings.parse({}));
const out = {
  picked: await run({ pick: "second" }),
  unknownPick: await run({ pick: "local" }),
  recorded: await run({ recorded: "third" }, "chat"),
  system: await run({ system: "grade" }, "grade"),
};
await updateSettings(LOCAL_USER_ID, Settings.parse({ models: { lesson: { provider: "spacexai", id: "third" }, chat: { provider: "spacexai", id: "second" } } }));
out.pickOverDefault = await run({ pick: "first" });
out.defaultOverRecorded = await run({ recorded: "third" }, "chat");
connected = false;
out.disconnected = await run({ pick: "first" });
console.log(JSON.stringify({ out, seen }));
`;

async function runIsolated(): Promise<{ out: string; err: string; code: number }> {
  const proc = Bun.spawn(["bun", "-"], { stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  proc.stdin.write(script);
  await proc.stdin.end();
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  return { out, err, code };
}

test("model selection: explicit pick, then task default, then recorded lesson model, then first connected model", async () => {
  const result = await runIsolated();
  expect(result.err).toBe("");
  expect(result.code).toBe(0);
  const { out, seen } = JSON.parse(result.out.trim()) as { out: Record<string, string>; seen: string[] };
  expect(out).toEqual({
    picked: "second",
    unknownPick: "first",
    recorded: "third",
    system: "first",
    pickOverDefault: "first",
    defaultOverRecorded: "second",
    disconnected: "err:not_connected",
  });
  expect(seen).toEqual(["second", "first", "third", "first", "first", "second"]);
});
