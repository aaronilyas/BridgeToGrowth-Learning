import { describe, expect, test } from "bun:test";
import { ASSET_NAMES, assetNameOf, backupFileName, backupsToPrune, compareSemver, findReleaseAsset, installKindOf, isAllowedDownloadUrl, isReleaseAssetUrl, parseAssetDigest, parseSemver, toReleaseList, type GithubRelease, type InstallProbe } from "./core.ts";

const REPO = "aaronilyas/BridgeToGrowth-Learning";
const DIGEST = `sha256:${"a".repeat(64)}`;

function release(tag: string, extra: Partial<GithubRelease> = {}): GithubRelease {
  return {
    tag,
    name: `BridgeToGrowth Learning ${tag.replace(/^v/, "")}`,
    draft: false,
    prerelease: false,
    publishedAt: "2026-10-01T00:00:00Z",
    htmlUrl: `https://github.com/${REPO}/releases/tag/${tag}`,
    body: "notes",
    assets: Object.values(ASSET_NAMES).map((name) => ({ name, size: 10, digest: DIGEST, url: `https://github.com/${REPO}/releases/download/${tag}/${name}` })),
    ...extra,
  };
}

const PROBE: InstallProbe = { platform: "linux", arch: "x64", channel: "stable", execPath: "/opt/BridgeToGrowthLearning/bin/bun", appImage: undefined, hasUninstaller: false };

describe("versions", () => {
  test("parses only plain x.y.z tags", () => {
    expect(parseSemver("v1.2.3")).toEqual([1, 2, 3]);
    expect(parseSemver("0.10.0")).toEqual([0, 10, 0]);
    expect(parseSemver("v1.2.3-beta.1")).toBeNull();
    expect(parseSemver("latest")).toBeNull();
  });

  test("orders numerically, not as text", () => {
    const [a, b] = [parseSemver("0.10.0"), parseSemver("0.9.9")];
    if (a === null || b === null) throw new Error("parse failed");
    expect(compareSemver(a, b)).toBeGreaterThan(0);
  });
});

describe("toReleaseList", () => {
  test("keeps stable releases newest first and marks each against the running version", () => {
    const list = toReleaseList([release("v0.1.0"), release("v0.3.0"), release("v0.2.0"), release("v0.4.0", { prerelease: true }), release("v0.5.0", { draft: true }), release("nightly")], "0.2.0", ASSET_NAMES.deb);
    expect(list.map((r) => [r.version, r.relation])).toEqual([["0.3.0", "newer"], ["0.2.0", "current"], ["0.1.0", "older"]]);
    expect(list[0]?.asset).toEqual({ name: ASSET_NAMES.deb, size: 10, checksum: true });
  });

  test("a release without this machine's file, or without a digest, says so", () => {
    const list = toReleaseList([release("v0.2.0", { assets: [] }), release("v0.1.0", { assets: [{ name: ASSET_NAMES.windows, size: 5, digest: null, url: "x" }] })], "0.1.0", ASSET_NAMES.windows);
    expect(list[0]?.asset).toBeNull();
    expect(list[1]?.asset?.checksum).toBe(false);
  });

  test("finds the asset of a stable tag only", () => {
    const releases = [release("v0.2.0"), release("v0.3.0", { prerelease: true })];
    expect(findReleaseAsset(releases, "0.2.0", ASSET_NAMES.appimage)?.asset.name).toBe(ASSET_NAMES.appimage);
    expect(findReleaseAsset(releases, "v0.3.0", ASSET_NAMES.appimage)).toBeNull();
  });
});

describe("install kind and asset", () => {
  test("recognises each installer's layout on a stable build", () => {
    expect(installKindOf(PROBE)).toBe("deb");
    expect(installKindOf({ ...PROBE, appImage: "/home/me/BridgeToGrowthLearning-x86_64.AppImage", execPath: "/tmp/.mount_x/usr/lib/bin/bun" })).toBe("appimage");
    expect(installKindOf({ ...PROBE, platform: "win32", execPath: "C:\\Users\\me\\AppData\\Local\\Programs\\BridgeToGrowth Learning\\bin\\bun.exe", hasUninstaller: true })).toBe("windows");
    expect(installKindOf({ ...PROBE, platform: "darwin", arch: "arm64" })).toBe("macos");
  });

  test("dev builds and unknown copies cannot install", () => {
    expect(installKindOf({ ...PROBE, channel: "dev" })).toBe("none");
    expect(installKindOf({ ...PROBE, execPath: "/home/me/src/bun" })).toBe("none");
    expect(installKindOf({ ...PROBE, platform: "win32", hasUninstaller: false })).toBe("none");
    expect(installKindOf({ ...PROBE, platform: "darwin", arch: "x64" })).toBe("none");
  });

  test("an unmanaged copy downloads the usual file for its OS, or none", () => {
    expect(assetNameOf("linux", "x64", "none")).toBe(ASSET_NAMES.appimage);
    expect(assetNameOf("linux", "x64", "deb")).toBe(ASSET_NAMES.deb);
    expect(assetNameOf("linux", "arm64", "none")).toBeNull();
    expect(assetNameOf("darwin", "x64", "none")).toBeNull();
  });
});

describe("integrity and hosts", () => {
  test("accepts only GitHub's sha256 digest form", () => {
    expect(parseAssetDigest(DIGEST)).toBe("a".repeat(64));
    expect(parseAssetDigest("sha1:abc")).toBeNull();
    expect(parseAssetDigest(null)).toBeNull();
  });

  test("the first hop must be this repository's release download", () => {
    expect(isReleaseAssetUrl(`https://github.com/${REPO}/releases/download/v1.0.0/x.deb`, REPO)).toBe(true);
    expect(isReleaseAssetUrl(`https://github.com/someone/else/releases/download/v1.0.0/x.deb`, REPO)).toBe(false);
    expect(isReleaseAssetUrl(`http://github.com/${REPO}/releases/download/v1.0.0/x.deb`, REPO)).toBe(false);
    expect(isReleaseAssetUrl(`https://github.com.evil.test/${REPO}/releases/download/v1.0.0/x.deb`, REPO)).toBe(false);
  });

  test("redirects stay on GitHub download hosts", () => {
    expect(isAllowedDownloadUrl(new URL("https://release-assets.githubusercontent.com/a?b=c"))).toBe(true);
    expect(isAllowedDownloadUrl(new URL("https://example.com/a"))).toBe(false);
    expect(isAllowedDownloadUrl(new URL("https://release-assets.githubusercontent.com:8443/a"))).toBe(false);
  });
});

describe("backups", () => {
  test("names carry the version and a sortable time, and only the newest are kept", () => {
    const names = [
      backupFileName("0.1.0", new Date("2026-01-01T00:00:00Z")),
      backupFileName("0.2.0", new Date("2026-03-01T00:00:00Z")),
      backupFileName("0.1.0", new Date("2026-02-01T00:00:00Z")),
      "btg.sqlite",
    ];
    expect(names[0]).toBe("btg-before-0.1.0-20260101T000000Z.sqlite");
    expect(backupsToPrune(names, 2)).toEqual([names[0] ?? ""]);
  });
});
