import { timingSafeEqual } from "node:crypto";

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
// INV: null until boot (or the test kit) binds the loopback socket
export function guardOrigin(): string | null {
  return runtimeOrigin;
}

// O(1)
// SEC: exact origin match only; localhost, 127.0.0.1 and ::1 are different origins, and no origin is allowed before boot sets one
export function originAllowed(header: string | null, appOrigin: string | null): boolean {
  if (header === null || appOrigin === null) return false;
  try {
    return new URL(header).origin === new URL(appOrigin).origin;
  } catch {
    return false;
  }
}

// O(1)
// SEC: reject DNS rebinding before serving API, documents, or assets; /api requires the launch token
export function localGuard(req: Request, host: string, token: string): Response | null {
  if (req.headers.get("host") !== host) return new Response(null, { status: 421 });
  const path = new URL(req.url).pathname;
  if ((path === "/api" || path.startsWith("/api/")) && !tokenMatches(req.headers.get("x-btg-token"), token)) return new Response(null, { status: 401 });
  if (!SAFE_METHODS.has(req.method) && !originAllowed(req.headers.get("origin"), guardOrigin() ?? `http://${host}`)) return new Response(null, { status: 403 });
  return null;
}
