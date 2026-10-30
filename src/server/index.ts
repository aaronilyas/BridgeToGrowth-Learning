import index from "../web/index.html";
import { env } from "./env.ts";
import { json, route } from "./http.ts";
import { genRoutes } from "./gen/routes.ts";
import { learnRoutes } from "./learn/routes.ts";
import { startPricingRefresh } from "./llm/gateway.ts";
import { SERVER_IDLE_TIMEOUT_S } from "./llm/timeouts.ts";
import { llmRoutes } from "./llm/routes.ts";
import { resetReservations } from "./llm/sql.ts";
import { localRoutes } from "./local/routes.ts";
import { ensureLocalUser } from "./local/sql.ts";
import { seasonRoutes } from "./season/routes.ts";
import { statsRoutes } from "./stats/routes.ts";
import { styleRoutes } from "./styles/routes.ts";
import { teachRoutes } from "./teach/routes.ts";

const routes = {
  ...localRoutes,
  ...llmRoutes,
  ...learnRoutes,
  ...genRoutes,
  ...styleRoutes,
  ...teachRoutes,
  ...statsRoutes,
  ...seasonRoutes,
  "/api/health": { GET: route({}, async () => json({ ok: true })) },
  "/api/*": route({ csrf: false }, async () => json({ error: "not_found" }, 404)),
  "/*": index,
};

// INV: single process ⇒ no in-flight reservations at boot
await ensureLocalUser();
await resetReservations();
startPricingRefresh();

// INV: idleTimeout stays above the model budgets in llm/timeouts.ts. Bun's default of 10s resets the socket before a lesson step or chat reply is written.
Bun.serve({ hostname: "127.0.0.1", port: env.PORT, maxRequestBodySize: 12 * 2 ** 20, idleTimeout: SERVER_IDLE_TIMEOUT_S, routes });
