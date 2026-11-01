import { expect, test } from "bun:test";
import { TEST_ENV } from "../testkit.ts";

Object.assign(process.env, TEST_ENV);
const { codeRuntime, runInSandbox } = await import("./sandbox.ts");
const enabled = (await codeRuntime()).enabled;

test.skipIf(!enabled)("a user cannot run two sandboxes at once", async () => {
  const [first, second] = await Promise.allSettled([runInSandbox("u1", [], "for i in range(3 * 10**7): pass", []), runInSandbox("u1", [], "print(1)", [])]);
  expect(first.status).toBe("fulfilled");
  expect(second.status === "rejected" && (second.reason as { code?: string }).code).toBe("rate_limited");
  expect((await runInSandbox("u2", [], "print(2)", [])).run.stdout.trim()).toBe("2");
});
