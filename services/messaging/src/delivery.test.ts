import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, request } from "node:http";
import { test, type TestContext } from "node:test";
import { createDeliveryHandler } from "./delivery.ts";
import { createPhotonDelivery } from "./photon.ts";

const headers = {
  Authorization: "Bearer test-only",
  "Content-Type": "video/mp4",
  "X-Recipient": "+15550000001",
  "X-Lesson-Job": "job-123",
};
const video = Buffer.from("temporary MP4 bytes");

async function serve(t: TestContext, deliver: (recipient: string, bytes: Buffer) => Promise<string>, maxVideoBytes = 1024) {
  const server = createServer(createDeliveryHandler({ token: "test-only", maxVideoBytes, deliver }));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  const address = server.address();
  assert(address && typeof address !== "string");
  return `http://127.0.0.1:${address.port}/video`;
}

test("unauthorized and malformed requests never contact Photon", async t => {
  let calls = 0;
  const url = await serve(t, async () => { calls++; return "unexpected"; });
  const cases = [
    { change: { Authorization: "" }, status: 401 },
    { change: { Authorization: "Bearer wrong" }, status: 401 },
    { change: { Authorization: "Basic test-only" }, status: 401 },
    { change: { "X-Recipient": "15550000001" }, status: 400 },
    { change: { "X-Recipient": "" }, status: 400 },
    { change: { "X-Lesson-Job": "" }, status: 400 },
    { change: { "Content-Type": "application/json" }, status: 415 },
  ];
  for (const { change, status } of cases) {
    const response = await fetch(url, { method: "POST", headers: { ...headers, ...change }, body: video });
    assert.equal(response.status, status);
    const body = await response.json() as { accepted?: unknown };
    assert.notEqual(body.accepted, true);
  }
  assert.equal((await fetch(url, { method: "POST", headers, body: "" })).status, 400);
  assert.equal((await fetch(url, { headers })).status, 405);
  assert.equal((await fetch(url + "/unknown", { method: "POST", headers, body: video })).status, 404);
  assert.equal(calls, 0);
});

test("bounded uploads reject both content-length and chunked oversized bodies", async t => {
  let calls = 0;
  const url = await serve(t, async () => { calls++; return "unexpected"; }, 4);
  assert.equal((await fetch(url, { method: "POST", headers, body: video })).status, 413);
  const status = await new Promise<number | undefined>((resolve, reject) => {
    const upload = request(url, { method: "POST", headers }, response => {
      response.resume();
      response.on("end", () => resolve(response.statusCode));
    });
    upload.on("error", reject);
    upload.write(video);
    upload.end();
  });
  assert.equal(status, 413);
  assert.equal(calls, 0);
});

test("acceptance waits for the entire body and Photon, then returns the provider ID", async t => {
  let calls = 0;
  let accept!: (id: string) => void;
  let contacted!: () => void;
  const contact = new Promise<void>(resolve => { contacted = resolve; });
  const pending = new Promise<string>(resolve => { accept = resolve; });
  const url = await serve(t, async (recipient, bytes) => {
    calls++;
    assert.equal(recipient, headers["X-Recipient"]);
    assert.deepEqual(bytes, video);
    contacted();
    return pending;
  });
  let responded = false;
  const upload = request(url, { method: "POST", headers });
  const result = new Promise<{ status: number | undefined; body: unknown }>((resolve, reject) => {
    upload.on("error", reject);
    upload.on("response", response => {
      responded = true;
      const chunks: Buffer[] = [];
      response.on("data", chunk => chunks.push(chunk));
      response.on("end", () => resolve({ status: response.statusCode, body: JSON.parse(Buffer.concat(chunks).toString()) }));
    });
  });
  upload.write(video.subarray(0, 4));
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(calls, 0);
  upload.end(video.subarray(4));
  await contact;
  assert.equal(responded, false);
  accept("photon-guid");
  assert.deepEqual(await result, { status: 202, body: { accepted: true, message_id: "photon-guid" } });
  assert.equal(calls, 1);
});

test("provider rejection or missing acceptance ID cannot acknowledge delivery", async t => {
  for (const deliver of [
    async () => { throw new Error("private provider failure"); },
    async () => "",
    async () => "   ",
  ]) {
    const url = await serve(t, deliver);
    const response = await fetch(url, { method: "POST", headers, body: video });
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { error: "Photon acceptance not confirmed" });
  }
});

test("Photon adapter routes to the recipient and sends an in-memory MP4 attachment", async t => {
  const user = { id: headers["X-Recipient"] };
  const deliver = createPhotonDelivery({
    user: async phone => { assert.equal(phone, user.id); return user; },
    space: { create: async recipient => {
      assert.equal(recipient, user);
      return { send: async builder => {
        const content = await builder.build();
        assert.equal(content.type, "attachment");
        if (content.type !== "attachment") throw new Error("Expected attachment");
        assert.equal(content.name, "lesson.mp4");
        assert.equal(content.mimeType, "video/mp4");
        assert.deepEqual(await content.read(), video);
        return { id: "provider-message-guid" };
      } };
    } },
  });
  const url = await serve(t, deliver);
  const response = await fetch(url, { method: "POST", headers, body: video });
  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { accepted: true, message_id: "provider-message-guid" });
});

test("Photon adapter rejects SDK no-ops, blank IDs, and send failures", async () => {
  for (const send of [
    async () => undefined,
    async () => ({ id: "" }),
    async () => ({ id: " " }),
    async () => { throw new Error("Photon rejected attachment"); },
  ]) {
    const deliver = createPhotonDelivery({
      user: async phone => phone,
      space: { create: async () => ({ send }) },
    });
    await assert.rejects(deliver(headers["X-Recipient"], video));
  }
});

test("missing shared token fails closed", () => {
  assert.throws(() => createDeliveryHandler({ token: "", maxVideoBytes: 1024, deliver: async () => "id" }));
});
