// O(1)
// SEC: Google supports only a strict nonce CSP for AdSense; 'strict-dynamic' trusts scripts a nonced script inserts, and 'unsafe-inline' and https: are fallbacks that CSP3 browsers ignore when a nonce is present
// SEC: frames, images and fetches must reach Google's rotating ad hosts, so those directives open to https:
export function adsCspOf(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'nonce-${nonce}' 'strict-dynamic' 'unsafe-inline' 'unsafe-eval' https:`,
    "frame-src https:",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "connect-src 'self' https:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

// O(1)
// INV: Google's IAB seller line; the publisher id is the client id without its "ca-" prefix
export function adsTxtOf(client: string): string {
  return `google.com, ${client.replace(/^ca-/, "")}, DIRECT, f08c47fec0942fa0\n`;
}

// O(1)
// INV: a top-level page load, judged by Sec-Fetch-Dest and, for browsers that omit it, an Accept that leads with text/html
export function isDocumentRequest(method: string, headers: Headers): boolean {
  if (method !== "GET") return false;
  const dest = headers.get("sec-fetch-dest");
  if (dest !== null) return dest === "document";
  return (headers.get("accept") ?? "").startsWith("text/html");
}

// O(1)
export function isHtmlResponse(res: Response): boolean {
  return res.status === 200 && (res.headers.get("content-type") ?? "").startsWith("text/html");
}
