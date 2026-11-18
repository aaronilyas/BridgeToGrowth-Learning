import index from "../web/index.html";
import { json, route } from "./http.ts";
import { MAX_REQUEST_BYTES, servePublic, type ApiRoutes } from "./listener.ts";
import { setRuntimeOrigin } from "./localGuard.ts";
import { setExternalOpener } from "./external.ts";
import { activateDatabase } from "./db.ts";
import { join } from "node:path";
import { appDataDir } from "./paths.ts";
import { bindStable, readSavedPort, savePort } from "./stablePort.ts";
import { dataRoutes } from "./data/routes.ts";
import { genRoutes } from "./gen/routes.ts";
import { learnRoutes } from "./learn/routes.ts";
import { SERVER_IDLE_TIMEOUT_S } from "./llm/timeouts.ts";
import { llmRoutes } from "./llm/routes.ts";
import { seasonRoutes } from "./season/routes.ts";
import { statsRoutes } from "./stats/routes.ts";
import { styleRoutes } from "./styles/routes.ts";
import { teachRoutes } from "./teach/routes.ts";
import { setAppShell, type AppShell } from "./updates/install.ts";
import { updateRoutes } from "./updates/routes.ts";

const apiRoutes: ApiRoutes = {
  ...llmRoutes,
  ...dataRoutes,
  ...learnRoutes,
  ...genRoutes,
  ...styleRoutes,
  ...teachRoutes,
  ...statsRoutes,
  ...seasonRoutes,
  ...updateRoutes,
  "/api/health": { GET: route({}, async () => json({ ok: true })) },
  "/api/*": route({ csrf: false }, async () => json({ error: "not_found" }, 404)),
};

// O(1)
// INV: one loopback listener per call
// SEC: the mutation origin is the bound loopback origin; an omitted port lets the kernel choose one, unless stablePort asks for the port saved in the app-data dir
// SEC: a stable port does not make the origin a credential. The launch token is still fresh per launch and required on every /api request, and localGuard still checks the exact Host and the Origin against the port actually bound. A port another process holds fails to bind, so this launch takes a fresh port (see bindStable) and the window never loads the other process
// INV: the desktop shell loads this module from the prebuilt bundle, so its native opener and app shell (release channel, quit, open, reveal) are handed in here rather than set on a second copy of external.ts or updates/install.ts
export async function startServer(opts: { token: string; port?: number; stablePort?: boolean; openExternal?: (url: string) => boolean; shell?: AppShell }): Promise<{ url: string; origin: string; stop: () => Promise<void> }> {
  if (opts.openExternal) setExternalOpener(opts.openExternal);
  if (opts.shell) setAppShell(opts.shell);
  const dataDir = appDataDir();
  await activateDatabase();
  // SEC: API is served on the public loopback socket; the upstream handles documents and assets only, on its own random port
  const upstream = Bun.serve({ id: "btg-upstream", hostname: "127.0.0.1", port: 0, maxRequestBodySize: MAX_REQUEST_BYTES, idleTimeout: SERVER_IDLE_TIMEOUT_S, routes: { "/*": index } });
  const listen = (port: number) => servePublic({ port, api: apiRoutes, upstream: upstream.url, token: opts.token });
  let server: ReturnType<typeof servePublic>;
  if (opts.port === undefined && opts.stablePort) {
    const portFile = join(dataDir, "listen-port");
    const bound = bindStable(readSavedPort(portFile), listen);
    server = bound.server;
    if (bound.changed && server.port !== undefined) savePort(portFile, server.port);
  } else {
    server = listen(opts.port ?? 0);
  }
  const origin = `http://127.0.0.1:${server.port}`;
  setRuntimeOrigin(origin);
  return { url: origin, origin, stop: async () => { await server.stop(true); await upstream.stop(true); } };
}
