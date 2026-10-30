import { beforeAll, expect, test } from "bun:test";
import { bootTestServer, callRoute, type Handler, type TestServer } from "../testkit.ts";

let t: TestServer;
let me: Handler;

beforeAll(async () => {
  t = await bootTestServer();
  me = (await import("./routes.ts")).localRoutes["/api/me"].GET;
});

test("me returns the local user and the free entitlement without a session", async () => {
  await t.reset();
  const res = await callRoute(me, "GET", "/api/me");
  expect(res.status).toBe(200);
  expect(res.headers.get("set-cookie")).toBeNull();
  const body = await res.json();
  expect(body.email).toBe("local@localhost");
  expect(body.entitlement).toEqual({ plan: "free", capMicros: 0 });
  const again = await callRoute(me, "GET", "/api/me");
  expect((await again.json()).id).toBe(body.id);
});
