import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SMOKE_ENV: Record<string, string> = { NODE_ENV: "development" };

// O(1)
function fillSmokeEnv(): void {
  for (const [key, value] of Object.entries(SMOKE_ENV)) {
    if (!process.env[key]) process.env[key] = value;
  }
}

// O(1) plus two health requests
// INV: isolated smoke data is removed even when a health check fails
async function runSmoke(): Promise<void> {
  fillSmokeEnv();
  const dataDir = await mkdtemp(join(tmpdir(), "btg-smoke-"));
  process.env.BTG_DATA_DIR = dataDir;
  const token = "a".repeat(64);
  try {
    const { startServer } = await import("../src/server/boot.ts");
    const server = await startServer({ token });
    try {
      const good = await fetch(`${server.url}/api/health`, { headers: { "x-btg-token": token } });
      const bad = await fetch(`${server.url}/api/health`);
      if (good.status !== 200 || bad.status !== 401) throw new Error(`health check failed: token=${good.status}, missing=${bad.status}`);
      console.log(`smoke: authenticated /api/health ${good.status}; missing token ${bad.status}`);
    } finally {
      await server.stop();
    }
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
}

await runSmoke().then(() => process.exit(0), (error: unknown) => {
  console.error(error instanceof Error ? error.message : "smoke failed");
  process.exit(1);
});
