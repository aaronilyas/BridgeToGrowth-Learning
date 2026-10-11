import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { test } from "node:test";
import { createDeliveryHandler } from "./delivery.ts";
import { createPhotonVerification } from "./photon.ts";

test("verification adapter uses the installed SDK text builder and rejects no-op sends", async () => {
  const transport = createPhotonVerification({ user: async phone => phone,
    space: { create: async phone => {
      assert.equal(phone, "+15550000001");
      return { send: async builder => {
        const content = await builder.build();
        assert.equal(content.type, "text");
        if (content.type !== "text") throw Error("Expected text");
        assert.match(content.text, /123456/);
        assert.match(content.text, /10 minutes/);
        return { id: "verification-id" };
      } };
    } } });
  assert.equal(await transport("+15550000001", "123456"), "verification-id");
  for (const result of [undefined, { id: "" }, { id: " " }]) {
    const bad = createPhotonVerification({ user: async phone => phone,
      space: { create: async () => ({ send: async () => result }) } });
    await assert.rejects(bad("+15550000001", "123456"));
  }
});

test("private verification endpoint authenticates and bounds JSON before contacting Photon", async t => {
  let calls = 0;
  const server = createServer(createDeliveryHandler({ token: "test-only", maxVideoBytes: 1024,
    deliver: async () => "video-id", verification: async (phone, code) => {
      calls++;
      assert.equal(phone, "+15550000001");
      assert.equal(code, "123456");
      return "verification-id";
    } }));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const address = server.address();
  assert(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}/verification`;
  const headers = { Authorization: "Bearer test-only", "Content-Type": "application/json" };
  for (const [body, status] of [["{}", 400], ["null", 400], ["[]", 400], ["{", 400],
    [JSON.stringify({ recipient: "+15550000001", code: "abc" }), 400],
    [JSON.stringify({ recipient: "+15550000001", code: "123456", bypass: true }), 400], ["a".repeat(1025), 413]] as const) {
    assert.equal((await fetch(url, { method: "POST", headers, body })).status, status);
  }
  assert.equal((await fetch(url, { method: "POST", body: "{}" })).status, 401);
  assert.equal(calls, 0);
  const response = await fetch(url, { method: "POST", headers,
    body: JSON.stringify({ recipient: "+15550000001", code: "123456" }) });
  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { accepted: true, message_id: "verification-id" });
  assert.equal(calls, 1);
});
