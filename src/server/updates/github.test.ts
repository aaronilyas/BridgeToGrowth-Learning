import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HttpError } from "../http.ts";
import type { GithubAsset } from "./core.ts";
import { clearReleaseCache, downloadReleaseAsset, fetchGithubReleases, type Fetcher } from "./github.ts";

const REPO = "aaronilyas/BridgeToGrowth-Learning";
const BYTES = new TextEncoder().encode("installer bytes");
const SHA = new Bun.CryptoHasher("sha256").update(BYTES).digest("hex");
const FIRST = `https://github.com/${REPO}/releases/download/v0.2.0/BridgeToGrowthLearning-amd64.deb`;
const SIGNED = "https://release-assets.githubusercontent.com/github-production-release-asset/1/2?sig=x";

function asset(extra: Partial<GithubAsset> = {}): GithubAsset {
  return { name: "BridgeToGrowthLearning-amd64.deb", size: BYTES.byteLength, digest: `sha256:${SHA}`, url: FIRST, ...extra };
}

// O(1)
function redirectingFetcher(final: Response, location: string = SIGNED): { fetcher: Fetcher; seen: string[] } {
  const seen: string[] = [];
  const fetcher: Fetcher = async (url) => {
    seen.push(url);
    if (url === FIRST) return new Response(null, { status: 302, headers: { location } });
    return final;
  };
  return { fetcher, seen };
}

// O(1)
async function codeOf(run: Promise<unknown>): Promise<string> {
  try {
    await run;
    return "none";
  } catch (cause) {
    return cause instanceof HttpError ? cause.code : "other";
  }
}

afterEach(() => clearReleaseCache());

describe("downloadReleaseAsset", () => {
  test("follows GitHub's redirect and keeps a file whose SHA-256 matches", async () => {
    const dest = join(mkdtempSync(join(tmpdir(), "btg-dl-")), "app.deb");
    const { fetcher, seen } = redirectingFetcher(new Response(BYTES, { headers: { "content-length": String(BYTES.byteLength) } }));
    const progress: number[] = [];
    await downloadReleaseAsset({ asset: asset(), dest, signal: new AbortController().signal, onProgress: (n) => progress.push(n), fetcher });
    expect(seen).toEqual([FIRST, SIGNED]);
    expect(readFileSync(dest)).toEqual(Buffer.from(BYTES));
    expect(progress.at(-1)).toBe(BYTES.byteLength);
  });

  test("a checksum mismatch deletes the download", async () => {
    const dest = join(mkdtempSync(join(tmpdir(), "btg-dl-")), "app.deb");
    const { fetcher } = redirectingFetcher(new Response(BYTES));
    const code = await codeOf(downloadReleaseAsset({ asset: asset({ digest: `sha256:${"0".repeat(64)}` }), dest, signal: new AbortController().signal, onProgress: () => undefined, fetcher }));
    expect(code).toBe("update_integrity");
    expect(existsSync(dest)).toBe(false);
    expect(existsSync(`${dest}.part`)).toBe(false);
  });

  test("a body longer than GitHub reported is refused", async () => {
    const dest = join(mkdtempSync(join(tmpdir(), "btg-dl-")), "app.deb");
    const { fetcher } = redirectingFetcher(new Response(new Uint8Array(BYTES.byteLength + 5)));
    const code = await codeOf(downloadReleaseAsset({ asset: asset(), dest, signal: new AbortController().signal, onProgress: () => undefined, fetcher }));
    expect(code).toBe("update_integrity");
    expect(existsSync(dest)).toBe(false);
  });

  test("no digest, a foreign first URL, or a redirect off GitHub is never fetched to disk", async () => {
    const dest = join(mkdtempSync(join(tmpdir(), "btg-dl-")), "app.deb");
    const signal = new AbortController().signal;
    const ok = (): Response => new Response(BYTES);
    expect(await codeOf(downloadReleaseAsset({ asset: asset({ digest: null }), dest, signal, onProgress: () => undefined, fetcher: redirectingFetcher(ok()).fetcher }))).toBe("update_integrity");
    expect(await codeOf(downloadReleaseAsset({ asset: asset({ url: "https://github.com/other/repo/releases/download/v1/x.deb" }), dest, signal, onProgress: () => undefined, fetcher: redirectingFetcher(ok()).fetcher }))).toBe("upstream");
    const offsite = redirectingFetcher(ok(), "https://example.com/payload");
    expect(await codeOf(downloadReleaseAsset({ asset: asset(), dest, signal, onProgress: () => undefined, fetcher: offsite.fetcher }))).toBe("upstream");
    expect(offsite.seen).toEqual([FIRST]);
    expect(existsSync(dest)).toBe(false);
  });
});

describe("fetchGithubReleases", () => {
  const LIST = [{ tag_name: "v0.2.0", name: "BridgeToGrowth Learning 0.2.0", draft: false, prerelease: false, published_at: "2026-10-01T00:00:00Z", html_url: "https://github.com/x", body: "notes", assets: [{ name: "a.deb", size: 3, digest: "sha256:ab", browser_download_url: FIRST, state: "uploaded" }, { name: "b.deb", size: 3, browser_download_url: FIRST, state: "starter" }] }];

  test("parses the list, drops unfinished uploads, and serves the cache until refresh", async () => {
    let calls = 0;
    const fetcher: Fetcher = async () => {
      calls += 1;
      return Response.json(LIST);
    };
    const first = await fetchGithubReleases({ refresh: false, fetcher, now: 1000 });
    expect(first.releases[0]?.assets.map((a) => a.name)).toEqual(["a.deb"]);
    await fetchGithubReleases({ refresh: false, fetcher, now: 2000 });
    expect(calls).toBe(1);
    await fetchGithubReleases({ refresh: true, fetcher, now: 3000 });
    expect(calls).toBe(2);
  });

  test("a GitHub failure returns the last good list, or upstream when there is none", async () => {
    const down: Fetcher = async () => new Response("rate limited", { status: 403 });
    expect(await codeOf(fetchGithubReleases({ refresh: true, fetcher: down }))).toBe("upstream");
    await fetchGithubReleases({ refresh: true, fetcher: async () => Response.json(LIST), now: 1 });
    const stale = await fetchGithubReleases({ refresh: true, fetcher: down, now: 2 });
    expect(stale.releases[0]?.tag).toBe("v0.2.0");
  });
});
