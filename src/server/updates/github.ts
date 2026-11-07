import { rename, rm } from "node:fs/promises";
import { z } from "zod";
import { APP_VERSION, RELEASE_REPO } from "../../shared/version.ts";
import { HttpError } from "../http.ts";
import { MAX_ASSET_BYTES, isAllowedDownloadUrl, isReleaseAssetUrl, parseAssetDigest, type GithubAsset, type GithubRelease } from "./core.ts";

export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

const RawAsset = z.object({ name: z.string(), size: z.number().int().min(0), digest: z.string().nullish(), browser_download_url: z.string(), state: z.string().optional() });
const RawRelease = z.object({ tag_name: z.string(), name: z.string().nullish(), draft: z.boolean(), prerelease: z.boolean(), published_at: z.string().nullish(), html_url: z.string(), body: z.string().nullish(), assets: z.array(RawAsset) });
const RawList = z.array(RawRelease).max(100);

const LIST_URL = `https://api.github.com/repos/${RELEASE_REPO}/releases?per_page=30`;
const LIST_CACHE_MS = 10 * 60 * 1000;
const LIST_MAX_BYTES = 4 * 1024 * 1024;
const LIST_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 5;
const USER_AGENT = `BridgeToGrowth-Learning/${APP_VERSION}`;

let cached: { at: number; releases: GithubRelease[] } | null = null;

// O(n) in releases
function toGithubRelease(raw: z.infer<typeof RawRelease>): GithubRelease {
  return {
    tag: raw.tag_name,
    name: raw.name ?? null,
    draft: raw.draft,
    prerelease: raw.prerelease,
    publishedAt: raw.published_at ?? null,
    htmlUrl: raw.html_url,
    body: raw.body ?? null,
    assets: raw.assets.filter((a) => a.state === undefined || a.state === "uploaded").map((a): GithubAsset => ({ name: a.name, size: a.size, digest: a.digest ?? null, url: a.browser_download_url })),
  };
}

// O(n) in body size
// SEC: the body is read incrementally and abandoned past the cap
async function readResponseCapped(res: Response, cap: number): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    size += result.value.byteLength;
    if (size > cap) {
      await reader.cancel();
      throw new HttpError(502, "upstream");
    }
    chunks.push(result.value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

// O(n) in releases; one HTTP call on a cache miss
// INV: a fresh list is reused for LIST_CACHE_MS (GitHub allows 60 unauthenticated calls an hour); if GitHub fails, the last good list is returned when there is one
// SEC: the request carries no credentials and only a generic app user agent
export async function fetchGithubReleases(opts: { refresh: boolean; fetcher?: Fetcher; now?: number }): Promise<{ releases: GithubRelease[]; at: number }> {
  const now = opts.now ?? Date.now();
  if (cached !== null && !opts.refresh && now - cached.at < LIST_CACHE_MS) return cached;
  const fetcher = opts.fetcher ?? fetch;
  try {
    const res = await fetcher(LIST_URL, { headers: { accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "user-agent": USER_AGENT }, signal: AbortSignal.timeout(LIST_TIMEOUT_MS), redirect: "error" });
    if (!res.ok) throw new HttpError(502, "upstream");
    let raw: unknown;
    try {
      raw = JSON.parse(await readResponseCapped(res, LIST_MAX_BYTES));
    } catch (cause) {
      if (cause instanceof HttpError) throw cause;
      throw new HttpError(502, "upstream");
    }
    const parsed = RawList.safeParse(raw);
    if (!parsed.success) throw new HttpError(502, "upstream");
    cached = { at: now, releases: parsed.data.map(toGithubRelease) };
    return cached;
  } catch (cause) {
    if (cached !== null) return cached;
    if (cause instanceof HttpError) throw cause;
    throw new HttpError(502, "upstream");
  }
}

// O(1)
// INV: tests start from an empty cache
export function clearReleaseCache(): void {
  cached = null;
}

// O(redirects)
// SEC: redirects are followed by hand so every hop is checked against the GitHub download hosts before it is requested
async function openAssetStream(url: string, fetcher: Fetcher, signal: AbortSignal): Promise<Response> {
  let next = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await fetcher(next, { headers: { accept: "application/octet-stream", "user-agent": USER_AGENT }, redirect: "manual", signal });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      await res.body?.cancel();
      const target = location === null ? null : URL.parse(location, next);
      if (target === null || !isAllowedDownloadUrl(target)) throw new HttpError(502, "upstream");
      next = target.href;
      continue;
    }
    if (!res.ok || res.body === null) throw new HttpError(502, "upstream");
    return res;
  }
  throw new HttpError(502, "upstream");
}

// O(n) in asset size
// INV: dest appears only when every byte arrived and the SHA-256 equals GitHub's published digest; otherwise the partial file is deleted
// SEC: an asset without a digest, larger than MAX_ASSET_BYTES, outside this repository's release downloads, or longer or shorter than GitHub reported is refused
export async function downloadReleaseAsset(opts: { asset: GithubAsset; dest: string; signal: AbortSignal; onProgress: (received: number) => void; fetcher?: Fetcher }): Promise<void> {
  const { asset, dest, signal } = opts;
  const expected = parseAssetDigest(asset.digest);
  if (expected === null || asset.size <= 0 || asset.size > MAX_ASSET_BYTES) throw new HttpError(422, "update_integrity");
  if (!isReleaseAssetUrl(asset.url, RELEASE_REPO)) throw new HttpError(502, "upstream");
  const res = await openAssetStream(asset.url, opts.fetcher ?? fetch, signal);
  const declared = Number(res.headers.get("content-length") ?? asset.size);
  if (declared !== asset.size) {
    await res.body?.cancel();
    throw new HttpError(422, "update_integrity");
  }
  const part = `${dest}.part`;
  const writer = Bun.file(part).writer();
  const hasher = new Bun.CryptoHasher("sha256");
  let received = 0;
  let ok = false;
  let closed = false;
  try {
    const reader = res.body?.getReader();
    if (!reader) throw new HttpError(502, "upstream");
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      received += result.value.byteLength;
      if (received > asset.size) {
        await reader.cancel();
        throw new HttpError(422, "update_integrity");
      }
      hasher.update(result.value);
      writer.write(result.value);
      opts.onProgress(received);
    }
    closed = true;
    await writer.end();
    if (received !== asset.size || hasher.digest("hex") !== expected) throw new HttpError(422, "update_integrity");
    await rename(part, dest);
    ok = true;
  } finally {
    if (!ok) {
      if (!closed) {
        try {
          await writer.end();
        } catch {
          // INV: the partial file is removed next whatever the sink reports
        }
      }
      await rm(part, { force: true });
    }
  }
}
