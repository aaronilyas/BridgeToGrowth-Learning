import type { AdsConfig } from "../../shared/api.ts";
import { hashToken, readSessionToken } from "../auth/core.ts";
import { findSession } from "../auth/sql.ts";
import { entitlementOf } from "../billing/core.ts";
import { env } from "../env.ts";
import { HttpError, route, secureResponse } from "../http.ts";
import { adsCspOf, adsTxtOf, isDocumentRequest, isHtmlResponse } from "./core.ts";

// O(1)
// INV: null unless both ADSENSE_CLIENT and ADSENSE_SLOT are set (env.ts requires them as a pair)
export function readAdsConfig(): AdsConfig | null {
  return env.ADSENSE_CLIENT && env.ADSENSE_SLOT ? { client: env.ADSENSE_CLIENT, slot: env.ADSENSE_SLOT } : null;
}

// O(1)
function createNonce(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("base64");
}

// O(1) plus one indexed session lookup
// SEC: a failed lookup counts as pro, so an error falls back to the strict CSP rather than the ad policy
async function isProDocumentRequest(req: Request): Promise<boolean> {
  const token = readSessionToken(req.headers.get("cookie"));
  if (!token) return false;
  try {
    const found = await findSession(hashToken(token));
    return found !== null && entitlementOf(found).plan === "pro";
  } catch {
    return true;
  }
}

// O(1)
// INV: every ad-serving document carries a fresh nonce, so a cached copy must never be revalidated against a new header
export function stripDocumentConditionals(req: Request, headers: Headers): void {
  if (!readAdsConfig() || !isDocumentRequest(req.method, req.headers)) return;
  headers.delete("if-none-match");
  headers.delete("if-modified-since");
}

// O(n) in document size
// SEC: pro and failed-lookup documents keep the strict CSP and never load Google's script; free and signed-out documents get the nonce policy so ads can load after an in-app sign-in
export async function decorateDocument(req: Request, res: Response): Promise<Response> {
  if (!readAdsConfig() || !isDocumentRequest(req.method, req.headers) || !isHtmlResponse(res) || (await isProDocumentRequest(req))) return secureResponse(res);
  const nonce = createNonce();
  const rewritten = new HTMLRewriter().on("script", { element: (el) => void el.setAttribute("nonce", nonce) }).transform(res);
  const headers = new Headers(rewritten.headers);
  for (const name of ["content-length", "etag", "last-modified"]) headers.delete(name);
  headers.set("cache-control", "no-store");
  return secureResponse(new Response(rewritten.body, { status: rewritten.status, headers }), adsCspOf(nonce));
}

const adsTxt = route({ csrf: false }, async () => {
  const ads = readAdsConfig();
  if (!ads) throw new HttpError(404, "not_found");
  return new Response(adsTxtOf(ads.client), { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600" } });
});

export const adsRoutes = {
  "/ads.txt": { GET: adsTxt },
};
