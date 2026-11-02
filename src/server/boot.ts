import index from "../web/index.html";
import { adsRoutes } from "./ads/routes.ts";
import { accountRoutes } from "./auth/account.ts";
import { authRoutes } from "./auth/routes.ts";
import { deleteExpiredPasswordResets, deleteExpiredSessions } from "./auth/sql.ts";
import { billingRoutes } from "./billing/routes.ts";
import { pruneStripeEvents } from "./billing/sql.ts";
import { json, route } from "./http.ts";
import { MAX_REQUEST_BYTES, servePublic, type ApiRoutes } from "./listener.ts";
import { setRuntimeOrigin } from "./localGuard.ts";
import { appDataDir } from "./paths.ts";
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

const apiRoutes: ApiRoutes = {
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
  ...adsRoutes,
  "/api/health": { GET: route({}, async () => json({ ok: true })) },
  "/api/*": route({ csrf: false }, async () => json({ error: "not_found" }, 404)),
};

const HOUR_MS = 3_600_000;
const SWEEP_MS = 15 * 60_000;

// O(1) per tick
// INV: background sweeps never throw into the event loop; failures are logged without detail
function scheduleSweep(name: string, everyMs: number, fn: () => Promise<unknown>): ReturnType<typeof setInterval> {
  const run = (): void => void fn().catch(() => console.error(`${name} sweep failed`));
  run();
  return setInterval(run, everyMs).unref();
}

// O(1) startup plus background cleanup
// INV: single process ⇒ no in-flight reservations at boot; one loopback listener per call
// SEC: the mutation origin is the bound loopback origin; an omitted port lets the kernel choose one
export async function startServer(opts: { token: string; port?: number }): Promise<{ url: string; origin: string; stop: () => Promise<void> }> {
  appDataDir();
  await resetReservations();
  startPricingRefresh();
  void codeRuntime();
  const timers = [
    scheduleSweep("session", HOUR_MS, async () => { await deleteExpiredSessions(); await deleteExpiredPasswordResets(); }),
    scheduleSweep("lesson expiry", SWEEP_MS, deleteExpiredLessons),
    scheduleSweep("stripe event", 24 * HOUR_MS, pruneStripeEvents),
  ];
  // SEC: API is served on the random public loopback socket; the upstream handles documents and assets only
  const upstream = Bun.serve({ id: "btg-upstream", hostname: "127.0.0.1", port: 0, maxRequestBodySize: MAX_REQUEST_BYTES, idleTimeout: SERVER_IDLE_TIMEOUT_S, routes: { "/*": index } });
  const server = servePublic({ port: opts.port ?? 0, api: apiRoutes, upstream: upstream.url, token: opts.token });
  const origin = `http://127.0.0.1:${server.port}`;
  setRuntimeOrigin(origin);
  return { url: origin, origin, stop: async () => { timers.forEach(clearInterval); await server.stop(true); await upstream.stop(true); } };
}
