import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TEST_ENV } from "./testkit.ts";

// O(1)
// INV: runs before test modules so env parsing and the first database open stay on a temp directory
export function prepareTestProcess(): void {
  process.env.BTG_DATA_DIR ??= mkdtempSync(join(tmpdir(), "btg-"));
  Object.assign(process.env, TEST_ENV);
}

prepareTestProcess();
