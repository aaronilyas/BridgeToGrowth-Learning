import { randomBytes } from "node:crypto";
import { startServer } from "./boot.ts";

// O(1)
// SEC: the 256-bit per-launch capability is printed only for an explicit headless operator
async function runHeadless(): Promise<void> {
  const token = randomBytes(32).toString("hex");
  const server = await startServer({ token });
  console.log(`BTG_URL=${server.url}`);
  console.log(`BTG_TOKEN=${token}`);
  const shutdown = (): void => void server.stop().finally(() => process.exit(0));
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

await runHeadless();
