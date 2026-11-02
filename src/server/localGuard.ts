import { timingSafeEqual } from "node:crypto";

const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(["localhost", "127.0.0.1", "::1"]);
const SAFE_METHODS: ReadonlySet<string> = new Set(["GET", "HEAD", "OPTIONS"]);
let runtimeOrigin: string | null = null;

// O(1)
// SEC: compare launch tokens with a constant-time primitive; a length mismatch still rejects
export function tokenMatches(actual: string | null, expected: string): boolean {
  const got = Buffer.from(actual ?? "", "utf8");
  const want = Buffer.from(expected, "utf8");
  if (got.length !== want.length) {
    timingSafeEqual(want, want);
    return false;
  }
  return timingSafeEqual(got, want);
}

// O(1)
// SEC: boot sets the sole mutation origin from the bound loopback socket
export function setRuntimeOrigin(origin: string): void {
  runtimeOrigin = origin;
}

// O(1)
export function guardOrigin(fallback: string): string {
  return runtimeOrigin ?? fallback;
}

// O(1)
// SEC: the browser sets Origin, so another site cannot claim a loopback origin; localhost, 127.0.0.1, and ::1 are one local app when the scheme and port match
export function originAllowed(header: string | null, appOrigin: string): boolean {
  if (header === null) return false;
  let sent: URL;
  let allowed: URL;
  try {
    sent = new URL(header);
    allowed = new URL(appOrigin);
  } catch {
    return false;
  }
  if (sent.origin === allowed.origin) return true;
  if (sent.protocol !== allowed.protocol || sent.port !== allowed.port) return false;
  const sentHost = sent.hostname.startsWith("[") && sent.hostname.endsWith("]") ? sent.hostname.slice(1, -1) : sent.hostname;
  const allowedHost = allowed.hostname.startsWith("[") && allowed.hostname.endsWith("]") ? allowed.hostname.slice(1, -1) : allowed.hostname;
  return LOOPBACK_HOSTS.has(sentHost) && LOOPBACK_HOSTS.has(allowedHost);
}

// O(1)
// SEC: reject DNS rebinding before serving API, documents, or assets; /api requires the launch token
export function localGuard(req: Request, host: string, token: string): Response | null {
  if (req.headers.get("host") !== host) return new Response(null, { status: 421 });
  if (new URL(req.url).pathname.startsWith("/api/") && !tokenMatches(req.headers.get("x-btg-token"), token)) return new Response(null, { status: 401 });
  if (!SAFE_METHODS.has(req.method) && !originAllowed(req.headers.get("origin"), guardOrigin(`http://${host}`))) return new Response(null, { status: 403 });
  return null;
}
