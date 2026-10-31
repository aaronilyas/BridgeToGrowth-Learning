import index from "../web/index.html";
import { accountRoutes } from "./auth/account.ts";
import { authRoutes } from "./auth/routes.ts";
import { deleteExpiredPasswordResets, deleteExpiredSessions } from "./auth/sql.ts";
import { billingRoutes } from "./billing/routes.ts";
import { pruneStripeEvents } from "./billing/sql.ts";
import { env } from "./env.ts";
import { json, route } from "./http.ts";
import { codeRoutes } from "./code/routes.ts";
import { codeRuntime } from "./code/sandbox.ts";
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
import { deleteExpiredLessons } from "./teach/sql.ts";

const routes = {
  ...authRoutes,
  ...accountRoutes,
  ...billingRoutes,
  ...llmRoutes,
  ...learnRoutes,
  ...genRoutes,
  ...codeRoutes,
  ...styleRoutes,
  ...teachRoutes,
  ...statsRoutes,
  ...seasonRoutes,
  "/api/health": { GET: route({}, async () => json({ ok: true })) },
  "/api/*": route({ csrf: false }, async () => json({ error: "not_found" }, 404)),
  "/*": index,
};

const HOUR_MS = 3_600_000;
const SWEEP_MS = 15 * 60_000;

// O(1) per tick
// INV: background sweeps never throw into the event loop; failures are logged without detail
function scheduleSweep(name: string, everyMs: number, fn: () => Promise<unknown>): void {
  const run = (): void => void fn().catch(() => console.error(`${name} sweep failed`));
  run();
  setInterval(run, everyMs).unref();
}

// INV: single process ⇒ no in-flight reservations at boot
await resetReservations();
startPricingRefresh();
void codeRuntime();
scheduleSweep("session", HOUR_MS, async () => {
  await deleteExpiredSessions();
  await deleteExpiredPasswordResets();
});
scheduleSweep("lesson expiry", SWEEP_MS, deleteExpiredLessons);
scheduleSweep("stripe event", 24 * HOUR_MS, pruneStripeEvents);

// INV: idleTimeout stays above the model budgets in llm/timeouts.ts. Bun's default of 10s resets the socket before a lesson step or chat reply is written.
Bun.serve({ hostname: "127.0.0.1", port: env.PORT, maxRequestBodySize: 80 * 2 ** 20, idleTimeout: SERVER_IDLE_TIMEOUT_S, routes });
