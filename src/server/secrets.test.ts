import { afterAll, beforeAll, expect, test } from "bun:test";
import { unzipSync } from "fflate";
import type { ProviderId } from "../shared/providers.ts";
import type { ProviderAdapter } from "./llm/providers/types.ts";
import { bootTestServer, callRoute, type Handler } from "./testkit.ts";
import { deleteProviderKey, keyHint, readProviderKey, storeProviderKey, useSecretBox } from "./secrets.ts";

const KEY = "sk-test-SECRETKEY9999";
const box = new Map<string, string>();
useSecretBox({
  get: async ({ name }) => box.get(name) ?? null,
  set: async ({ name, value }) => { box.set(name, value); },
  delete: async ({ name }) => { box.delete(name); return true; },
});

let providers: Handler;
let exportData: Handler;
let restoreAdapters: Array<() => void> = [];

function quiet(id: ProviderId): ProviderAdapter {
  const auth = id === "codex" ? "subscription" : "api_key";
  return {
    id,
    auth,
    status: async () => ({ provider: id, auth, connected: false, detail: id === "codex" ? "logged_out" : "key_invalid" }),
    listModels: async () => [],
    stream: async function* () { yield { type: "done" }; },
  };
}

function contains(bytes: Uint8Array, needle: string): boolean {
  const encoded = new TextEncoder().encode(needle);
  outer: for (let i = 0; i <= bytes.length - encoded.length; i++) {
    for (let j = 0; j < encoded.length; j++) if (bytes[i + j] !== encoded[j]) continue outer;
    return true;
  }
  return false;
}

beforeAll(async () => {
  await bootTestServer();
  const { installProviderForTest } = await import("./llm/providers/registry.ts");
  restoreAdapters = (["openrouter", "codex", "spacexai"] as const).map((id) => installProviderForTest(id, quiet(id)));
  providers = (await import("./llm/routes.ts")).llmRoutes["/api/providers"].GET;
  exportData = (await import("./data/routes.ts")).dataRoutes["/api/data/export"].GET;
});

afterAll(() => {
  for (const restore of restoreAdapters) restore();
  useSecretBox(Bun.secrets);
});

test("a provider key round-trips through the secret box", async () => {
  await storeProviderKey("spacexai", KEY);
  expect(await readProviderKey("spacexai")).toBe(KEY);
  expect(keyHint(KEY)).toBe("9999");
  expect(keyHint("short")).toBeNull();
  await deleteProviderKey("spacexai");
  expect(await readProviderKey("spacexai")).toBeNull();
});

test("GET /api/providers never contains the key", async () => {
  await storeProviderKey("openrouter", KEY);
  const res = await callRoute(providers, "GET", "/api/providers");
  expect(res.status).toBe(200);
  const text = await res.text();
  expect(text.includes(KEY)).toBe(false);
  expect(text.includes("9999")).toBe(true);
});

test("an export zip never contains the key", async () => {
  await storeProviderKey("openrouter", KEY);
  const res = await callRoute(exportData, "GET", "/api/data/export");
  expect(res.status).toBe(200);
  const bytes = new Uint8Array(await res.arrayBuffer());
  expect(contains(bytes, KEY)).toBe(false);
  const files = unzipSync(bytes);
  for (const file of Object.values(files)) expect(contains(file, KEY)).toBe(false);
});
