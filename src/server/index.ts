import index from "../web/index.html";
import { authRoutes } from "./auth/routes.ts";
import { deleteExpiredSessions } from "./auth/sql.ts";
import { billingRoutes } from "./billing/routes.ts";
import { env } from "./env.ts";
import { json, route } from "./http.ts";
import { startPricingRefresh } from "./llm/gateway.ts";
import { llmRoutes } from "./llm/routes.ts";
import { resetReservations } from "./llm/sql.ts";

const routes = {
  ...authRoutes,
  ...billingRoutes,
  ...llmRoutes,
  "/api/health": { GET: route({}, async () => json({ ok: true })) },
  "/api/*": route({ csrf: false }, async () => json({ error: "not_found" }, 404)),
  "/*": index,
};

// INV: single process ⇒ no in-flight reservations at boot
await resetReservations();
startPricingRefresh();

Bun.serve({ hostname: "127.0.0.1", port: env.PORT, maxRequestBodySize: 12 * 2 ** 20, routes });

setInterval(() => void deleteExpiredSessions().catch((e) => console.error(e instanceof Error ? e.message : "session sweep failed")), 3_600_000).unref();
