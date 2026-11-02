import type { Server } from "bun";
import { decorateDocument, stripDocumentConditionals } from "./ads/routes.ts";
import { env } from "./env.ts";
import { json, secureResponse } from "./http.ts";
import { SERVER_IDLE_TIMEOUT_S } from "./llm/timeouts.ts";

export const MAX_REQUEST_BYTES = 80 * 2 ** 20;

type ApiHandler = (req: Request & { params?: Record<string, string> }) => Promise<Response>;
export type ApiRoutes = Record<string, ApiHandler | Partial<Record<"GET" | "POST" | "PUT" | "PATCH" | "DELETE", ApiHandler>>>;
type UpstreamSocket = { url: string; inner: WebSocket | null; pending: Array<string | Buffer> };

const HASHED_ASSET = /^\/chunk-[a-z0-9]+\.(?:js|css)$/;
const ASSET_TYPES = ["text/javascript", "application/javascript", "text/css"];
const IMMUTABLE = "public, max-age=31536000, immutable";
const SKIP_REQUEST_HEADERS = new Set(["connection", "keep-alive", "proxy-connection", "transfer-encoding", "upgrade", "te", "trailer", "accept-encoding"]);

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

// O(n) in header count
// INV: only a production bundle chunk (content-hashed name, 200, JS or CSS body) is cached as immutable; a stale hash that falls through to the HTML document keeps Bun's headers
function cacheHashedAsset(path: string, res: Response): Response {
  if (env.NODE_ENV !== "production" || res.status !== 200 || !HASHED_ASSET.test(path)) return res;
  const type = (res.headers.get("content-type") ?? "").toLowerCase();
  if (!ASSET_TYPES.some((t) => type.startsWith(t))) return res;
  const headers = new Headers(res.headers);
  headers.set("cache-control", IMMUTABLE);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

// O(1) plus the upstream round trip
// INV: only paths outside `api` reach here (HTML bundle, hashed assets, dev HMR); every response leaves through decorateDocument or secureResponse
async function proxyDocument(req: Request, upstream: URL): Promise<Response> {
  try {
    const url = new URL(req.url);
    const headers = forwardedHeaders(req.headers);
    stripDocumentConditionals(req, headers);
    const init: RequestInit & { proxy: false; duplex?: "half" } = { method: req.method, headers, redirect: "manual", proxy: false };
    if (req.method !== "GET" && req.method !== "HEAD") {
      init.body = req.body;
      init.duplex = "half";
    }
    const res = await fetch(new URL(url.pathname + url.search, upstream), init);
    return await decorateDocument(req, cacheHashedAsset(url.pathname, res));
  } catch {
    return secureResponse(json({ error: "internal" }, 500));
  }
}

// O(1) per request plus the handler
// INV: `api` handlers are built with route(), which wraps every response (including errors) in secureResponse, so they are mounted directly with no loopback hop
// INV: `api` must not contain "/*"; the HTML bundle stays on the upstream so its responses pass through decorateDocument (ads nonce CSP) and secureResponse
// INV: maxRequestBodySize caps every body at the socket; route maxBody still caps each route below that
// INV: idleTimeout stays above the model budgets in llm/timeouts.ts. Bun's default of 10s resets the socket before a lesson step or chat reply is written.
// SEC: binds 127.0.0.1 only; Caddy is the only ingress
export function servePublic(o: { port: number; api: ApiRoutes; upstream: URL }): Server<UpstreamSocket> {
  if ("/*" in o.api) throw new Error("the document route belongs on the upstream");
  return Bun.serve<UpstreamSocket>({
    id: "btg",
    hostname: "127.0.0.1",
    port: o.port,
    maxRequestBodySize: MAX_REQUEST_BYTES,
    idleTimeout: SERVER_IDLE_TIMEOUT_S,
    routes: o.api,
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
        const target = new URL(url.pathname + url.search, o.upstream).href.replace(/^http/, "ws");
        if (server.upgrade(req, { data: { url: target, inner: null, pending: [] } })) return;
        return secureResponse(new Response(null, { status: 400 }));
      }
      return proxyDocument(req, o.upstream);
    },
    error() {
      return secureResponse(json({ error: "internal" }, 500));
    },
  });
}
