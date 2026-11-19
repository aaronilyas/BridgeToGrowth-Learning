import { beforeEach } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resetRateBuckets } from "./rate.ts";
import { TEST_ENV } from "./testkit.ts";

// O(1)
// INV: runs before test modules so env parsing and the first database open stay on a temp directory
export function prepareTestProcess(): void {
  process.env.BTG_DATA_DIR ??= mkdtempSync(join(tmpdir(), "btg-"));
  Object.assign(process.env, TEST_ENV);
}

prepareTestProcess();

// INV: rate buckets are process-wide and every test file shares this process, so each test starts with full buckets
beforeEach(() => resetRateBuckets());
