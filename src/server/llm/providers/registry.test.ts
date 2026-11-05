import { expect, test } from "bun:test";

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
const model = { provider: "openrouter", id: "unit", label: "Unit", vision: false, structured: "prompted", reasoning: [], contextTokens: 1000 };
await updateSettings(LOCAL_USER_ID, Settings.parse({ models: { lesson: { provider: "openrouter", id: "unit" } } }));

function adapter(connected, stream) {
  return {
    id: "openrouter",
    auth: "api_key",
    status: async () => ({ provider: "openrouter", auth: "api_key", connected, detail: connected ? "ok" : "key_invalid" }),
    listModels: async () => [model],
    stream,
  };
}

async function failCode(connected, stream) {
  const restore = installProviderForTest("openrouter", adapter(connected, stream));
  try {
    await chatJson({ who: { uid: LOCAL_USER_ID }, model: { pick: "unit" }, kind: "lesson", system: "s", user: "u", schema: Out, maxTokens: 20 });
    return "resolved";
  } catch (error) {
    return error instanceof HttpError ? error.code : "other";
  } finally {
    restore();
  }
}

let calls = 0;
const retry = await failCode(true, () => {
  calls += 1;
  return (async function* () {
    yield { type: "text", delta: "not json" };
    yield { type: "done" };
  })();
});
let streamed = 0;
const disconnected = await failCode(false, () => {
  streamed += 1;
  return (async function* () { yield { type: "done" }; })();
});
if (retry !== "bad_output" || calls !== 2 || disconnected !== "not_connected" || streamed !== 0) {
  console.error(JSON.stringify({ retry, calls, disconnected, streamed }));
  process.exit(1);
}
console.log("ok");
`;

async function runIsolated(): Promise<{ out: string; err: string; code: number }> {
  const proc = Bun.spawn(["bun", "-"], { stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  proc.stdin.write(script);
  await proc.stdin.end();
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  return { out, err, code };
}

const isolated = runIsolated();

test("chatJson retries once on bad JSON, then fails with bad_output", async () => {
  const result = await isolated;
  expect(result.err).toBe("");
  expect(result.code).toBe(0);
  expect(result.out.trim()).toBe("ok");
});

test("a disconnected provider fails with not_connected", async () => {
  const result = await isolated;
  expect(result.code).toBe(0);
});
