import index from "../web/index.html";
import { authRoutes } from "./auth/routes.ts";
import { deleteExpiredSessions } from "./auth/sql.ts";
import { env } from "./env.ts";
import { json, route } from "./http.ts";

const routes = {
  ...authRoutes,
  "/api/health": { GET: route({}, async () => json({ ok: true })) },
  "/api/*": route({ csrf: false }, async () => json({ error: "not_found" }, 404)),
  "/*": index,
};

Bun.serve({ hostname: "127.0.0.1", port: env.PORT, maxRequestBodySize: 12 * 2 ** 20, routes });

setInterval(() => void deleteExpiredSessions().catch((e) => console.error(e instanceof Error ? e.message : "session sweep failed")), 3_600_000).unref();
