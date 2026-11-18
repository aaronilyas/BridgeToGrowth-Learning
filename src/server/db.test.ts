import { expect, test } from "bun:test";
import { bootTestServer } from "./testkit.ts";

// O(1)
async function readPragmas(sql: Awaited<ReturnType<typeof bootTestServer>>["sql"]): Promise<{ synchronous: number; temp_store: number }> {
  const syncRows = await sql`PRAGMA synchronous` as { synchronous: number }[];
  const tempRows = await sql`PRAGMA temp_store` as { temp_store: number }[];
  const synchronous = syncRows[0]?.synchronous;
  const temp_store = tempRows[0]?.temp_store;
  if (synchronous === undefined || temp_store === undefined) throw new Error("missing pragma row");
  return { synchronous, temp_store };
}

test("activateDatabase sets synchronous NORMAL and temp_store MEMORY on the live sql connection", async () => {
  const { sql } = await bootTestServer();
  expect(await readPragmas(sql)).toEqual({ synchronous: 1, temp_store: 2 });
  expect(await readPragmas(sql)).toEqual({ synchronous: 1, temp_store: 2 });
  const concurrent = await Promise.all(Array.from({ length: 8 }, () => readPragmas(sql)));
  for (const row of concurrent) expect(row).toEqual({ synchronous: 1, temp_store: 2 });
});
