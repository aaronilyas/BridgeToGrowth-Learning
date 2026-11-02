import index from "../web/index.html";
import { env } from "./env.ts";
import { json, route } from "./http.ts";
import { MAX_REQUEST_BYTES, servePublic, type ApiRoutes } from "./listener.ts";
import { genRoutes } from "./gen/routes.ts";
import { learnRoutes } from "./learn/routes.ts";
import { startPricingRefresh } from "./llm/gateway.ts";
import { SERVER_IDLE_TIMEOUT_S } from "./llm/timeouts.ts";
import { llmRoutes } from "./llm/routes.ts";
import { resetReservations } from "./llm/sql.ts";
import { seasonRoutes } from "./season/routes.ts";
import { statsRoutes } from "./stats/routes.ts";
import { styleRoutes } from "./styles/routes.ts";
import { teachRoutes } from "./teach/routes.ts";

const apiRoutes: ApiRoutes = {
  ...llmRoutes,
  ...learnRoutes,
  ...genRoutes,
  ...styleRoutes,
  ...teachRoutes,
  ...statsRoutes,
  ...seasonRoutes,
  "/api/health": { GET: route({}, async () => json({ ok: true })) },
  "/api/*": route({ csrf: false }, async () => json({ error: "not_found" }, 404)),
};

await resetReservations();
startPricingRefresh();

const upstream = Bun.serve({ id: "btg-upstream", hostname: "127.0.0.1", port: 0, maxRequestBodySize: MAX_REQUEST_BYTES, idleTimeout: SERVER_IDLE_TIMEOUT_S, routes: { "/*": index } });
servePublic({ port: env.PORT, api: apiRoutes, upstream: upstream.url });
