import { lookup } from "node:dns/promises";
import { HttpError } from "../http.ts";
import { sniffMime } from "../styles/core.ts";
import { MAX_PAGE_BYTES, MAX_PDF_BYTES, checkSourceUrl, htmlToText, isIpLiteral, isPublicIp, tidyText } from "./core.ts";

export type FetchedUrl = { kind: "pdf"; url: string; bytes: Uint8Array } | { kind: "text"; url: string; title: string; text: string };

const FETCH_TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 3;
const REDIRECTS: ReadonlySet<number> = new Set([301, 302, 303, 307, 308]);
const HTML_TYPES: ReadonlySet<string> = new Set(["text/html", "application/xhtml+xml"]);
const TEXT_TYPES: ReadonlySet<string> = new Set(["text/plain", "text/markdown", "text/x-markdown"]);

// O(1) plus one DNS lookup
// SEC: every resolved address must be public, so a host with one private record is refused; the vetted address (IPv4 first) is the one connected to
async function resolvePublic(host: string): Promise<string> {
  const bare = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
  if (isIpLiteral(bare)) {
    if (!isPublicIp(bare)) throw new HttpError(422, "source_blocked");
    return bare;
  }
  const addrs = await lookup(bare, { all: true, verbatim: true }).catch(() => []);
  const first = addrs.find((a) => a.family === 4) ?? addrs[0];
  if (!first) throw new HttpError(422, "source_unreadable");
  if (addrs.some((a) => !isPublicIp(a.address))) throw new HttpError(422, "source_blocked");
  return first.address;
}

// O(1)
// SEC: connects to the vetted IP, sends the real Host header and verifies TLS against the real hostname, so DNS rebinding between check and connect cannot redirect the request; no cookies or credentials are sent
async function fetchPinned(url: URL, signal: AbortSignal): Promise<Response> {
  const ip = await resolvePublic(url.hostname);
  const target = new URL(url);
  target.hostname = ip.includes(":") ? `[${ip}]` : ip;
  const init: BunFetchRequestInit = {
    method: "GET",
    redirect: "manual",
    signal,
    headers: { host: url.host, accept: "text/html,application/xhtml+xml,application/pdf,text/plain;q=0.9,*/*;q=0.1", "user-agent": "BridgeToGrowth-Learning/1.0 (lesson context fetcher)" },
    ...(url.protocol === "https:" ? { tls: { serverName: url.hostname } } : {}),
  };
  return fetch(target, init).catch((e: unknown) => {
    if (e instanceof HttpError) throw e;
    throw new HttpError(422, "source_unreadable");
  });
}

// O(n) bounded by cap
async function readCapped(res: Response, cap: number): Promise<{ bytes: Uint8Array; over: boolean }> {
  if (!res.body) return { bytes: new Uint8Array(), over: false };
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of res.body) {
    if (size + chunk.length > cap) {
      chunks.push(chunk.subarray(0, cap - size));
      await res.body.cancel().catch(() => undefined);
      return { bytes: Buffer.concat(chunks), over: true };
    }
    size += chunk.length;
    chunks.push(chunk);
  }
  return { bytes: Buffer.concat(chunks), over: false };
}

// O(n)
function decodeBody(bytes: Uint8Array, contentType: string): string {
  const charset = /charset\s*=\s*"?([\w-]{1,40})/i.exec(contentType)?.[1] ?? "utf-8";
  try {
    return new TextDecoder(charset, { fatal: false }).decode(bytes);
  } catch {
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  }
}

// O(n) in response size
// SEC: follows at most MAX_REDIRECTS hops by hand and re-vets each target; one overall timeout; bodies are capped while streaming; only HTML, plain text and PDF are accepted
export async function fetchUrlSource(raw: string): Promise<FetchedUrl> {
  const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  let url = checkSourceUrl(raw);
  let res = await fetchPinned(url, signal);
  for (let hop = 0; REDIRECTS.has(res.status); hop++) {
    const loc = res.headers.get("location");
    await res.body?.cancel().catch(() => undefined);
    if (!loc || hop >= MAX_REDIRECTS) throw new HttpError(422, "source_unreadable");
    url = checkSourceUrl(new URL(loc, url).toString());
    res = await fetchPinned(url, signal);
  }
  if (!res.ok) {
    await res.body?.cancel().catch(() => undefined);
    throw new HttpError(422, "source_unreadable");
  }
  const type = res.headers.get("content-type") ?? "";
  const mime = (type.split(";")[0] ?? "").trim().toLowerCase();
  const isPdf = mime === "application/pdf";
  if (!isPdf && !HTML_TYPES.has(mime) && !TEXT_TYPES.has(mime)) {
    await res.body?.cancel().catch(() => undefined);
    throw new HttpError(415, "unsupported_media");
  }
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (isPdf && declared > MAX_PDF_BYTES) {
    await res.body?.cancel().catch(() => undefined);
    throw new HttpError(413, "too_large");
  }
  const body = await readCapped(res, isPdf ? MAX_PDF_BYTES : MAX_PAGE_BYTES).catch(() => {
    throw new HttpError(422, "source_unreadable");
  });
  if (sniffMime(body.bytes.subarray(0, 8)) === "application/pdf") {
    if (body.over) throw new HttpError(413, "too_large");
    return { kind: "pdf", url: url.toString(), bytes: body.bytes };
  }
  if (isPdf) throw new HttpError(422, "source_unreadable");
  const text = decodeBody(body.bytes, type);
  if (HTML_TYPES.has(mime)) {
    const h = htmlToText(text);
    return { kind: "text", url: url.toString(), title: h.title, text: h.text };
  }
  return { kind: "text", url: url.toString(), title: "", text: tidyText(text) };
}
