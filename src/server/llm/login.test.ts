import { afterAll, beforeAll, expect, test } from "bun:test";
import type { ConnectionStatus, ProviderAdapter } from "./providers/types.ts";
import { bootTestServer, callRoute, type Handler } from "../testkit.ts";
import { openExternalUrl, setExternalOpener } from "../external.ts";

type Routes = typeof import("./routes.ts").llmRoutes;
let routes: Routes;
let restore: () => void = () => undefined;
const opened: string[] = [];

function withParams(fn: Handler, params: Record<string, string>): Handler {
  return (req) => fn(Object.assign(req, { params }));
}

function signedInSpaceXai(): ProviderAdapter {
  const status: ConnectionStatus = { provider: "spacexai", auth: "subscription", connected: true, detail: "ok", subscription: "ok" };
  return { id: "spacexai", auth: "subscription", status: async () => status, listModels: async () => [], stream: async function* () { yield { type: "done" }; } };
}

beforeAll(async () => {
  await bootTestServer();
  const { installProviderForTest } = await import("./providers/registry.ts");
  restore = installProviderForTest("spacexai", signedInSpaceXai());
  routes = (await import("./routes.ts")).llmRoutes;
  setExternalOpener((url) => {
    opened.push(url);
    return true;
  });
});

afterAll(() => {
  restore();
});

test("login routes exist only for subscription providers", async () => {
  const poll = withParams(routes["/api/providers/:id/login"].GET, { id: "openrouter" });
  expect((await callRoute(poll, "GET", "/api/providers/openrouter/login")).status).toBe(404);
  const bogus = withParams(routes["/api/providers/:id/login"].GET, { id: "nope" });
  expect((await callRoute(bogus, "GET", "/api/providers/nope/login")).status).toBe(404);
  const grok = withParams(routes["/api/providers/:id/login"].GET, { id: "spacexai" });
  const res = await callRoute(grok, "GET", "/api/providers/spacexai/login");
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ state: "idle", method: "device" });
});

test("Claude has no sign-in, sign-out or key routes: it only uses an existing Claude Code sign-in", async () => {
  const poll = withParams(routes["/api/providers/:id/login"].GET, { id: "claude" });
  expect((await callRoute(poll, "GET", "/api/providers/claude/login")).status).toBe(404);
  const start = withParams(routes["/api/providers/:id/login"].POST, { id: "claude" });
  expect((await callRoute(start, "POST", "/api/providers/claude/login", { body: { method: "browser" } })).status).toBe(404);
  const logout = withParams(routes["/api/providers/:id/logout"].POST, { id: "claude" });
  expect((await callRoute(logout, "POST", "/api/providers/claude/logout")).status).toBe(404);
  const key = withParams(routes["/api/providers/:id/key"].PUT, { id: "claude" });
  expect((await callRoute(key, "PUT", "/api/providers/claude/key", { body: { key: "sk-ant-x" } })).status).toBe(400);
});

test("a SpaceXAI sign-in is refused while the subscription is signed in", async () => {
  const start = withParams(routes["/api/providers/:id/login"].POST, { id: "spacexai" });
  const res = await callRoute(start, "POST", "/api/providers/spacexai/login", { body: { method: "device" } });
  expect(res.status).toBe(409);
});

test("the SpaceXAI sign-in target opens nothing without a pending login", async () => {
  const res = await callRoute(routes["/api/open-external"].POST, "POST", "/api/open-external", { body: { target: "spacexai_signin" } });
  expect(res.status).toBe(404);
  expect(opened).toEqual([]);
});

test("the grok install page opens through the allowlist", async () => {
  const res = await callRoute(routes["/api/open-external"].POST, "POST", "/api/open-external", { body: { target: "grok_install" } });
  expect(res.status).toBe(204);
  expect(opened).toEqual(["https://docs.x.ai/build/overview"]);
});

test("the Claude Code install page opens through the allowlist", async () => {
  opened.length = 0;
  const res = await callRoute(routes["/api/open-external"].POST, "POST", "/api/open-external", { body: { target: "claude_install" } });
  expect(res.status).toBe(204);
  expect(opened).toEqual(["https://github.com/anthropics/claude-code"]);
});

test("only https xAI sign-in hosts are added to the external allowlist", () => {
  expect(openExternalUrl("https://accounts.x.ai/oauth2/device?user_code=V3MJ-FGHR")).toBe(true);
  expect(openExternalUrl("https://auth.x.ai/oauth2/authorize")).toBe(true);
  expect(openExternalUrl("http://accounts.x.ai/oauth2/device")).toBe(false);
  expect(openExternalUrl("https://x.ai.evil.example/")).toBe(false);
  expect(openExternalUrl("https://grok.com/")).toBe(false);
});
