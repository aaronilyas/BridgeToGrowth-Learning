import { expect, test } from "bun:test";
import { createStatusCache } from "./statusCache.ts";
import type { ConnectionStatus } from "./types.ts";

const ON: ConnectionStatus = { provider: "codex", auth: "subscription", connected: true, detail: "ok" };
const OFF: ConnectionStatus = { provider: "codex", auth: "subscription", connected: false, detail: "logged_out" };

// O(1)
function gate(): { promise: Promise<void>; open: () => void } {
  let open = (): void => undefined;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

test("concurrent reads share one in-flight check", async () => {
  let checks = 0;
  const g = gate();
  const cache = createStatusCache(async () => {
    checks += 1;
    await g.promise;
    return OFF;
  });
  const reads = [cache.read(), cache.read(), cache.read()];
  g.open();
  expect(await Promise.all(reads)).toEqual([OFF, OFF, OFF]);
  expect(checks).toBe(1);
});

test("a connected result is reused for at most the TTL, counted from when its check started", async () => {
  let clock = 1_000;
  let checks = 0;
  const cache = createStatusCache(async () => {
    checks += 1;
    clock += 500;
    return ON;
  }, 30_000, () => clock);
  await cache.read();
  clock = 1_000 + 29_999;
  await cache.read();
  expect(checks).toBe(1);
  clock = 1_000 + 30_000;
  await cache.read();
  expect(checks).toBe(2);
});

test("a not-connected result is never reused", async () => {
  let checks = 0;
  let connected = false;
  const cache = createStatusCache(async () => {
    checks += 1;
    return connected ? ON : OFF;
  });
  expect((await cache.read()).connected).toBe(false);
  connected = true;
  expect((await cache.read()).connected).toBe(true);
  expect(checks).toBe(2);
});

test("forget drops a kept result, and a check that started before forget is never kept", async () => {
  let checks = 0;
  let current = ON;
  const gates: Array<ReturnType<typeof gate>> = [];
  const cache = createStatusCache(async () => {
    checks += 1;
    const g = gate();
    gates.push(g);
    const answer = current;
    await g.promise;
    return answer;
  });
  const first = cache.read();
  gates[0]?.open();
  await first;
  cache.forget();
  const stale = cache.read();
  cache.forget();
  current = OFF;
  const fresh = cache.read();
  expect(checks).toBe(3);
  gates[1]?.open();
  gates[2]?.open();
  expect((await stale).connected).toBe(true);
  expect((await fresh).connected).toBe(false);
  current = ON;
  const next = cache.read();
  gates[3]?.open();
  await next;
  expect(checks).toBe(4);
});

test("a check that throws is not kept and its callers see the error", async () => {
  let checks = 0;
  const cache = createStatusCache(async () => {
    checks += 1;
    if (checks === 1) throw new Error("boom");
    return ON;
  });
  await expect(cache.read()).rejects.toThrow("boom");
  expect(await cache.read()).toEqual(ON);
  expect(checks).toBe(2);
});
