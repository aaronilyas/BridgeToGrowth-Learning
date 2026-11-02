import { expect, test } from "bun:test";
import { connect } from "node:net";
import { TEST_ENV } from "./testkit.ts";

Object.assign(process.env, TEST_ENV);

// O(1)
function httpExchange(port: number, method: string, path: string, headers: Record<string, string>): Promise<{ status: number; raw: string }> {
  const lines = [`${method} ${path} HTTP/1.1`, ...Object.entries(headers).map(([name, value]) => `${name}: ${value}`), "Connection: close", "", ""];
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const socket = connect(port, "127.0.0.1");
    socket.on("error", reject);
    socket.on("data", (chunk: Buffer) => chunks.push(chunk));
    socket.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      const status = Number((raw.split("\r\n", 1)[0] ?? "").split(" ")[1]);
      resolve({ status, raw });
    });
    socket.end(lines.join("\r\n"));
  });
}

test("local guard requires the launch token, exact host, and mutation origin", async () => {
  const { json, route } = await import("./http.ts");
  const { servePublic } = await import("./listener.ts");
  const token = "a".repeat(64);
  const upstream = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("doc") });
  const pub = servePublic({
    port: 0,
    token,
    upstream: upstream.url,
    api: {
      "/api/health": { GET: route({}, async () => json({ ok: true })) },
      "/api/mutate": { POST: route({ csrf: false }, async () => json({ ok: true })) },
    },
  });
  const port = pub.port ?? 0;
  const host = `127.0.0.1:${port}`;
  try {
    const missing = await httpExchange(port, "GET", "/api/health", { Host: host });
    const wrong = await httpExchange(port, "GET", "/api/health", { Host: host, "x-btg-token": "b".repeat(64) });
    const foreignHost = await httpExchange(port, "GET", "/api/health", { Host: "evil.test", "x-btg-token": token });
    const foreignOrigin = await httpExchange(port, "POST", "/api/mutate", { Host: host, "x-btg-token": token, Origin: "https://evil.test", "Content-Length": "0" });
    const ok = await httpExchange(port, "GET", "/api/health", { Host: host, "x-btg-token": token });
    expect(missing.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(foreignHost.status).toBe(421);
    expect(foreignOrigin.status).toBe(403);
    expect(ok.status).toBe(200);
    expect(ok.raw).toContain("\"ok\":true");
    expect(ok.raw.toLowerCase()).not.toContain("access-control-");
    expect(missing.raw.toLowerCase()).not.toContain("access-control-");
  } finally {
    pub.stop(true);
    upstream.stop(true);
  }
});
