import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProviderId } from "../../../shared/providers.ts";
import { useSecretBox } from "../../secrets.ts";
import { bootTestServer, callRoute, type Handler } from "../../testkit.ts";
import { createClaudeAdapter } from "./claude.ts";
import { createCodexAdapter } from "./codex.ts";
import { createSpaceXaiAdapter } from "./spacexai.ts";
import type { ConnectionStatus, LlmEvent, LlmRequest, ModelRef, ProviderAdapter } from "./types.ts";

type Registry = typeof import("./registry.ts");
const ORDER: ProviderId[] = ["openrouter", "codex", "spacexai", "claude"];
let registry: Registry;
let providersRoute: Handler;
const boxReads = new Map<string, number>();
const box = new Map<string, string>();

beforeAll(async () => {
  await bootTestServer();
  registry = await import("./registry.ts");
  providersRoute = (await import("../routes.ts")).llmRoutes["/api/providers"].GET;
  useSecretBox({
    get: async ({ name }) => {
      boxReads.set(name, (boxReads.get(name) ?? 0) + 1);
      return box.get(name) ?? null;
    },
    set: async ({ name, value }) => {
      box.set(name, value);
    },
    delete: async ({ name }) => box.delete(name),
  });
});

afterAll(() => {
  useSecretBox(Bun.secrets);
});

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function model(provider: ProviderId, id: string): ModelRef {
  return { provider, id, label: id, vision: false, structured: "prompted", reasoning: [], contextTokens: 1000 };
}

type Fake = { adapter: ProviderAdapter; checks: () => number; forgets: () => number };

// O(1)
function fake(id: ProviderId, connected: boolean, delayMs = 0): Fake {
  let checks = 0;
  let forgets = 0;
  const status: ConnectionStatus = { provider: id, auth: "api_key", connected, detail: connected ? "ok" : "key_invalid" };
  const adapter: ProviderAdapter = {
    id,
    auth: "api_key",
    status: async () => {
      checks += 1;
      await sleep(delayMs);
      return status;
    },
    forgetStatus: () => {
      forgets += 1;
    },
    listModels: async () => [model(id, `${id}-m`)],
    stream: async function* () {
      yield { type: "done" };
    },
  };
  return { adapter, checks: () => checks, forgets: () => forgets };
}

// O(p) in providers
function installAll(fakes: Fake[]): () => void {
  const restores = fakes.map((f) => registry.installProviderForTest(f.adapter.id, f.adapter));
  return () => {
    for (const restore of restores.reverse()) restore();
  };
}

function request(m: ModelRef): LlmRequest {
  return { model: m, system: "s", messages: [{ role: "user", text: "u" }], reasoning: "low", maxOutputTokens: 8, signal: AbortSignal.timeout(2000) };
}

async function drain(stream: AsyncIterable<LlmEvent>): Promise<LlmEvent[]> {
  const out: LlmEvent[] = [];
  for await (const event of stream) out.push(event);
  return out;
}

test("/api/providers checks providers in parallel and lists them in ProviderId order", async () => {
  const fakes = ORDER.map((id, i) => fake(id, i % 2 === 0, 120 - i * 30));
  const restore = installAll(fakes);
  try {
    const started = performance.now();
    const res = await callRoute(providersRoute, "GET", "/api/providers");
    const elapsed = performance.now() - started;
    const body = (await res.json()) as ConnectionStatus[];
    expect(body.map((s) => s.provider)).toEqual(ORDER);
    expect(body.map((s) => s.connected)).toEqual([true, false, true, false]);
    expect(elapsed).toBeLessThan(120 + 90 + 60 + 30);
  } finally {
    restore();
  }
});

test("connectedProviderIds and listConnectedModels check in parallel and keep the registry order", async () => {
  const fakes = ORDER.map((id) => fake(id, id !== "codex", id === "openrouter" ? 150 : 20));
  const restore = installAll(fakes);
  try {
    await registry.forgetProviderModels("openrouter");
    await registry.forgetProviderModels("spacexai");
    await registry.forgetProviderModels("claude");
    const started = performance.now();
    const [ids, models] = await Promise.all([registry.connectedProviderIds(), registry.listConnectedModels()]);
    expect(performance.now() - started).toBeLessThan(150 + 20 * 3);
    expect([...ids]).toEqual(["openrouter", "spacexai", "claude"]);
    expect(models.map((m) => m.provider)).toEqual(["openrouter", "spacexai", "claude"]);
  } finally {
    restore();
  }
});

test("one model resolution learns each provider's status at most once, connected or not", async () => {
  const fakes = ORDER.map((id) => fake(id, false));
  const restore = installAll(fakes);
  try {
    await expect(registry.resolveTaskModel({ provider: "codex", id: "codex-m" }, ["x"])).rejects.toMatchObject({ code: "not_connected" });
    expect(fakes.map((f) => f.checks())).toEqual([1, 1, 1, 1]);
  } finally {
    restore();
  }
  const online = ORDER.map((id) => fake(id, id === "claude"));
  const restoreOnline = installAll(online);
  try {
    await registry.forgetProviderModels("claude");
    expect((await registry.resolveTaskModel({ provider: "claude", id: "claude-m" }, [])).id).toBe("claude-m");
    expect(online.map((f) => f.checks())).toEqual([0, 0, 0, 1]);
  } finally {
    restoreOnline();
  }
});

test("adapters swapped in by installProviderForTest never see a status another test left behind", async () => {
  let signedIn = true;
  let reads = 0;
  const first = createClaudeAdapter({ which: () => "/usr/bin/claude", readStatus: async () => { reads += 1; return { code: signedIn ? 0 : 1, text: signedIn ? '{"loggedIn":true}' : "{}" }; } });
  const restore = registry.installProviderForTest("claude", first);
  expect((await registry.providerAdapter("claude").status()).connected).toBe(true);
  restore();
  signedIn = false;
  const again = registry.installProviderForTest("claude", first);
  try {
    expect((await registry.providerAdapter("claude").status()).connected).toBe(false);
    expect(reads).toBe(2);
  } finally {
    again();
  }
});

test("a codex model call runs `codex login status` once across status and stream", async () => {
  let statusRuns = 0;
  const adapter = createCodexAdapter({
    which: () => "/usr/bin/codex",
    statusCode: async () => {
      statusRuns += 1;
      return 0;
    },
    run: () => ({ lines: (async function* () {})(), stop: () => undefined }),
  });
  const restore = registry.installProviderForTest("codex", adapter);
  try {
    expect((await registry.statusLookup()("codex")).connected).toBe(true);
    await drain(adapter.stream(request(model("codex", "codex-m"))));
    expect(statusRuns).toBe(1);
  } finally {
    restore();
  }
});

test("a Grok model call asks the CLI once and a key-backed one probes the key once", async () => {
  let cliReads = 0;
  const sub = createSpaceXaiAdapter({
    which: () => "/usr/bin/grok",
    readModels: async () => {
      cliReads += 1;
      return "You are logged in with grok.com.\n\nAvailable models:\n  * grok-4.7 (default)\n";
    },
    readKey: async () => null,
    run: () => ({ lines: (async function* () {})(), stop: () => undefined }),
  });
  expect((await sub.status()).connected).toBe(true);
  await drain(sub.stream(request(model("spacexai", "grok-4.7"))));
  expect(cliReads).toBe(1);

  let probes = 0;
  let cliOut = 0;
  const fetchFn = Object.assign(async (url: string | URL | Request): Promise<Response> => {
    if (String(url).endsWith("/models")) {
      probes += 1;
      return new Response("{}", { status: 200 });
    }
    return new Response("no", { status: 500 });
  }, { preconnect: () => undefined }) as typeof fetch;
  const keyed = createSpaceXaiAdapter({
    which: () => "/usr/bin/grok",
    readModels: async () => {
      cliOut += 1;
      return "You are not authenticated.\n";
    },
    readKey: async () => "xai-key",
    fetchFn,
  });
  expect(await keyed.status()).toMatchObject({ connected: true, auth: "api_key", subscription: "logged_out" });
  await drain(keyed.stream(request(model("spacexai", "grok-4"))));
  expect(probes).toBe(1);
  expect(cliOut).toBe(1);
});

test("a Claude model call asks the CLI once across status and stream", async () => {
  let reads = 0;
  const adapter = createClaudeAdapter({
    which: () => "/usr/bin/claude",
    readStatus: async () => {
      reads += 1;
      return { code: 0, text: '{"loggedIn":true}' };
    },
    workDir: () => "/tmp",
    connect: () => {
      throw new Error("no agent in this test");
    },
  });
  expect((await adapter.status()).connected).toBe(true);
  await drain(adapter.stream(request(model("claude", "claude-m")))).catch(() => []);
  expect(reads).toBe(1);
});

test("one /api/providers request reads each provider's key from the keychain once", async () => {
  const { createOpenRouterAdapter } = await import("./openrouter.ts");
  const fetchFn = Object.assign(async (): Promise<Response> => new Response("{}", { status: 200 }), { preconnect: () => undefined }) as typeof fetch;
  box.set("openrouter", "sk-or-v1-0123456789");
  box.set("spacexai", "xai-0123456789");
  const restores = [
    registry.installProviderForTest("openrouter", createOpenRouterAdapter(fetchFn)),
    registry.installProviderForTest("spacexai", createSpaceXaiAdapter({ which: () => null, fetchFn })),
    registry.installProviderForTest("codex", fake("codex", false).adapter),
    registry.installProviderForTest("claude", fake("claude", false).adapter),
  ];
  try {
    boxReads.clear();
    const body = (await (await callRoute(providersRoute, "GET", "/api/providers")).json()) as Array<ConnectionStatus & { last4?: string }>;
    expect(body.map((s) => [s.provider, s.connected, s.last4 ?? null])).toEqual([["openrouter", true, "6789"], ["codex", false, null], ["spacexai", true, "6789"], ["claude", false, null]]);
    expect(Object.fromEntries(boxReads)).toEqual({ openrouter: 1, codex: 1, spacexai: 1, claude: 1 });
  } finally {
    for (const restore of restores.reverse()) restore();
    box.clear();
  }
});

// The login and logout routes start the official CLIs, so this part runs in its own process with stand-in `codex` and `grok` scripts first on PATH and HOME moved to a temp folder; the user's real CLIs are never run.
const routeScript = `
const { bootTestServer, callRoute } = await import("./src/server/testkit.ts");
await bootTestServer();
const { useSecretBox } = await import("./src/server/secrets.ts");
const box = new Map();
useSecretBox({ get: async ({ name }) => box.get(name) ?? null, set: async ({ name, value }) => { box.set(name, value); }, delete: async ({ name }) => box.delete(name) });
const { installProviderForTest } = await import("./src/server/llm/providers/registry.ts");
const forgets = { openrouter: 0, codex: 0, spacexai: 0, claude: 0 };
const fake = (id) => ({ id, auth: "subscription", status: async () => ({ provider: id, auth: "subscription", connected: false, detail: "logged_out", subscription: "logged_out" }), forgetStatus: () => { forgets[id] += 1; }, listModels: async () => [], stream: async function* () { yield { type: "done" }; } });
for (const id of Object.keys(forgets)) installProviderForTest(id, fake(id));
for (const id of Object.keys(forgets)) forgets[id] = 0;
globalThis.fetch = Object.assign(async () => new Response("{}", { status: 200 }), { preconnect: () => undefined });
const { llmRoutes } = await import("./src/server/llm/routes.ts");
const at = (fn, id) => (req) => fn(Object.assign(req, { params: { id } }));
const steps = [];
const step = async (label, run, id) => { const before = forgets[id]; const res = await run(); steps.push([label, res.status, forgets[id] - before]); };
const r = llmRoutes;
await step("put openrouter key", () => callRoute(at(r["/api/providers/:id/key"].PUT, "openrouter"), "PUT", "/api/providers/openrouter/key", { body: { key: "sk-or-v1-0123456789" } }), "openrouter");
await step("delete openrouter key", () => callRoute(at(r["/api/providers/:id/key"].DELETE, "openrouter"), "DELETE", "/api/providers/openrouter/key"), "openrouter");
for (const id of ["codex", "spacexai"]) {
  await step(id + " login start", () => callRoute(at(r["/api/providers/:id/login"].POST, id), "POST", "/api/providers/" + id + "/login", { body: { method: "device" } }), id);
  let polled = null;
  for (let i = 0; i < 100; i++) {
    const res = await callRoute(at(r["/api/providers/:id/login"].GET, id), "GET", "/api/providers/" + id + "/login");
    const body = await res.json();
    if (body.state === "ok") { polled = res; break; }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  const before = forgets[id];
  await callRoute(at(r["/api/providers/:id/login"].GET, id), "GET", "/api/providers/" + id + "/login");
  steps.push([id + " login poll ok", polled === null ? 0 : 200, forgets[id] - before]);
  await step(id + " logout", () => callRoute(at(r["/api/providers/:id/logout"].POST, id), "POST", "/api/providers/" + id + "/logout"), id);
}
console.log(JSON.stringify(steps));
process.exit(0);
`;

test("every in-app key save or delete, login start, successful login poll and logout forgets the provider's status", async () => {
  const dir = mkdtempSync(join(tmpdir(), "btg-cli-"));
  try {
    for (const name of ["codex", "grok"]) writeFileSync(join(dir, name), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    const proc = Bun.spawn([process.execPath, "-"], { stdin: "pipe", stdout: "pipe", stderr: "pipe", env: { ...process.env, PATH: `${dir}:/usr/bin:/bin`, HOME: dir } });
    proc.stdin.write(routeScript);
    await proc.stdin.end();
    const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    expect(code).toBe(0);
    const steps = JSON.parse(out.trim().split("\n").at(-1) ?? "[]") as Array<[string, number, number]>;
    expect(steps).toEqual([
      ["put openrouter key", 200, 1],
      ["delete openrouter key", 204, 1],
      ["codex login start", 200, 1],
      ["codex login poll ok", 200, 1],
      ["codex logout", 204, 1],
      ["spacexai login start", 200, 1],
      ["spacexai login poll ok", 200, 1],
      ["spacexai logout", 204, 1],
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
