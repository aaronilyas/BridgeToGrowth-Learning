import index from "../web/index.html";
import { json, route } from "./http.ts";
import { MAX_REQUEST_BYTES, servePublic, type ApiRoutes } from "./listener.ts";
import { setRuntimeOrigin } from "./localGuard.ts";
import { setExternalOpener } from "./external.ts";
import { activateDatabase } from "./db.ts";
import { appDataDir } from "./paths.ts";
import { dataRoutes } from "./data/routes.ts";
import { genRoutes } from "./gen/routes.ts";
import { learnRoutes } from "./learn/routes.ts";
import { SERVER_IDLE_TIMEOUT_S } from "./llm/timeouts.ts";
import { llmRoutes } from "./llm/routes.ts";
import { seasonRoutes } from "./season/routes.ts";
import { statsRoutes } from "./stats/routes.ts";
import { styleRoutes } from "./styles/routes.ts";
import { teachRoutes } from "./teach/routes.ts";

const apiRoutes: ApiRoutes = {
  ...llmRoutes,
  ...dataRoutes,
  ...learnRoutes,
  ...genRoutes,
  ...styleRoutes,
  ...teachRoutes,
  ...statsRoutes,
  ...seasonRoutes,
  "/api/health": { GET: route({}, async () => json({ ok: true })) },
  "/api/*": route({ csrf: false }, async () => json({ error: "not_found" }, 404)),
};

// O(1)
// INV: one loopback listener per call
// SEC: the mutation origin is the bound loopback origin; an omitted port lets the kernel choose one
// INV: the desktop shell loads this module from the prebuilt bundle, so its native opener is handed in here rather than set on a second copy of external.ts
export async function startServer(opts: { token: string; port?: number; openExternal?: (url: string) => boolean }): Promise<{ url: string; origin: string; stop: () => Promise<void> }> {
  if (opts.openExternal) setExternalOpener(opts.openExternal);
  appDataDir();
  await activateDatabase();
  // SEC: API is served on the random public loopback socket; the upstream handles documents and assets only
  const upstream = Bun.serve({ id: "btg-upstream", hostname: "127.0.0.1", port: 0, maxRequestBodySize: MAX_REQUEST_BYTES, idleTimeout: SERVER_IDLE_TIMEOUT_S, routes: { "/*": index } });
  const server = servePublic({ port: opts.port ?? 0, api: apiRoutes, upstream: upstream.url, token: opts.token });
  const origin = `http://127.0.0.1:${server.port}`;
  setRuntimeOrigin(origin);
  return { url: origin, origin, stop: async () => { await server.stop(true); await upstream.stop(true); } };
}
