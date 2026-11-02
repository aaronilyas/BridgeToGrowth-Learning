import index from "../web/index.html";
import { adsRoutes, decorateDocument, stripDocumentConditionals } from "./ads/routes.ts";
import { accountRoutes } from "./auth/account.ts";
import { authRoutes } from "./auth/routes.ts";
import { deleteExpiredPasswordResets, deleteExpiredSessions } from "./auth/sql.ts";
import { billingRoutes } from "./billing/routes.ts";
import { pruneStripeEvents } from "./billing/sql.ts";
import { env } from "./env.ts";
import { json, route, secureResponse } from "./http.ts";
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
  ...adsRoutes,
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

const SKIP_REQUEST_HEADERS = new Set(["connection", "keep-alive", "proxy-connection", "transfer-encoding", "upgrade", "te", "trailer", "accept-encoding"]);

type UpstreamSocket = { url: string; inner: WebSocket | null; pending: Array<string | Buffer> };

// O(n) in header count
function forwardedHeaders(src: Headers): Headers {
  const headers = new Headers();
  for (const [name, value] of src) {
    if (SKIP_REQUEST_HEADERS.has(name)) continue;
    headers.append(name, value);
  }
  headers.set("accept-encoding", "identity");
  return headers;
}

// O(1) plus the upstream round trip
// INV: idleTimeout stays above the model budgets in llm/timeouts.ts on both listeners. Bun's default of 10s resets the socket before a lesson step or chat reply is written.
// SEC: the public listener is 127.0.0.1:$PORT and Caddy is the only ingress. The loopback upstream exists so HTML-bundle responses can carry the same security headers as /api/*.
const upstream = Bun.serve({ id: "btg-upstream", hostname: "127.0.0.1", port: 0, maxRequestBodySize: 80 * 2 ** 20, idleTimeout: SERVER_IDLE_TIMEOUT_S, routes });

Bun.serve<UpstreamSocket>({
  id: "btg",
  hostname: "127.0.0.1",
  port: env.PORT,
  maxRequestBodySize: 80 * 2 ** 20,
  idleTimeout: SERVER_IDLE_TIMEOUT_S,
  websocket: {
    open(ws) {
      const client = new WebSocket(ws.data.url);
      (client as { binaryType: string }).binaryType = "nodebuffer";
      ws.data.inner = client;
      client.addEventListener("open", () => {
        const queued = ws.data.pending;
        ws.data.pending = [];
        for (const message of queued) client.send(typeof message === "string" ? message : Uint8Array.from(message));
      });
      client.addEventListener("message", (ev) => {
        if (ws.readyState !== WebSocket.OPEN) return;
        const data: unknown = ev.data;
        if (typeof data === "string" || data instanceof Uint8Array || data instanceof ArrayBuffer) ws.send(data);
      });
      const shut = (): void => { if (ws.readyState === WebSocket.OPEN) ws.close(); };
      client.addEventListener("close", shut);
      client.addEventListener("error", shut);
    },
    message(ws, message) {
      const client = ws.data.inner;
      if (client && client.readyState === WebSocket.OPEN) client.send(typeof message === "string" ? message : Uint8Array.from(message));
      else ws.data.pending.push(message);
    },
    close(ws) {
      ws.data.inner?.close();
    },
  },
  async fetch(req, server) {
    if ((req.headers.get("upgrade") ?? "").toLowerCase() === "websocket") {
      const url = new URL(req.url);
      const target = new URL(url.pathname + url.search, upstream.url).href.replace(/^http/, "ws");
      if (server.upgrade(req, { data: { url: target, inner: null, pending: [] } })) return;
      return secureResponse(new Response(null, { status: 400 }));
    }
    try {
      const url = new URL(req.url);
      const headers = forwardedHeaders(req.headers);
      stripDocumentConditionals(req, headers);
      const init: RequestInit & { proxy: false; duplex?: "half" } = { method: req.method, headers, redirect: "manual", proxy: false };
      if (req.method !== "GET" && req.method !== "HEAD") {
        init.body = req.body;
        init.duplex = "half";
      }
      return await decorateDocument(req, await fetch(new URL(url.pathname + url.search, upstream.url), init));
    } catch {
      return secureResponse(json({ error: "internal" }, 500));
    }
  },
  error() {
    return secureResponse(json({ error: "internal" }, 500));
  },
});
