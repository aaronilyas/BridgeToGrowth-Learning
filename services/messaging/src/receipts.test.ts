import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { readEvent, ReceiptForwarder, signedReceipt } from "./receipts.ts";

const message = { id: "provider-guid:read:3", platform: "imessage", sender: { id: "+15550000001" },
  timestamp: new Date("2026-10-10T12:00:00Z"), content: { type: "read", target: { id: "provider-guid", direction: "outbound" } } };

test("SDK receipts require an identified DM reader and outbound target", () => {
  const event = readEvent(message, "dm");
  assert.deepEqual(event, { event_id: message.id, message_id: "provider-guid", recipient: "+15550000001", read_at: message.timestamp.toISOString() });
  for (const input of [{ ...message, sender: undefined }, { ...message, platform: "local_imessage" },
    { ...message, content: { type: "text" } }, { ...message, sender: { id: "unknown" } },
    { ...message, content: { type: "read", target: { id: "guid", direction: "inbound" } } }]) {
    assert.equal(readEvent(input, "dm"), undefined);
  }
  assert.equal(readEvent(message, "group"), undefined);
});

test("callbacks sign the exact bytes and timestamp", () => {
  const event = readEvent(message, "dm")!;
  const secret = "synthetic-receipt-secret-".repeat(2);
  const signed = signedReceipt(event, secret, 1234);
  assert.equal(signed.headers["X-Receipt-Timestamp"], "1234");
  assert.equal(signed.headers["X-Receipt-Signature"], createHmac("sha256", secret).update(`1234.${signed.body}`).digest("hex"));
});

test("receipt metadata survives a restart and retries failed callbacks without video storage", async t => {
  const directory = await mkdtemp(join(tmpdir(), "btg-receipts-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const secret = "synthetic-receipt-secret-".repeat(2);
  const event = readEvent(message, "dm")!;
  const first = new ReceiptForwarder(directory, "http://coordinator.test/internal/receipts", secret);
  await first.enqueue(event);
  await first.enqueue(event);
  assert.equal((await readdir(directory)).length, 1);
  const second = new ReceiptForwarder(directory, "http://coordinator.test/internal/receipts", secret);
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async () => new Response("", { status: 503 });
  await second.flush();
  assert.equal((await readdir(directory)).length, 1);
  globalThis.fetch = async (_url, options) => {
    assert.deepEqual(JSON.parse(String(options?.body)), event);
    assert.ok((options?.headers as Record<string, string>)["X-Receipt-Signature"]);
    return new Response(null, { status: 204 });
  };
  await second.flush();
  assert.equal((await readdir(directory)).length, 0);
});
