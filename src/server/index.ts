import index from "../web/index.html";
import { env } from "./env.ts";
import { json, route } from "./http.ts";

const routes = {
  "/api/health": { GET: route({}, async () => json({ ok: true })) },
  "/api/*": route({ csrf: false }, async () => json({ error: "not_found" }, 404)),
  "/*": index,
};

Bun.serve({ hostname: "127.0.0.1", port: env.PORT, maxRequestBodySize: 12 * 2 ** 20, routes });
