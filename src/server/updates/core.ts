import type { InstallKind, ReleaseInfo, ReleaseRelation } from "../../shared/updates.ts";

export type GithubAsset = { name: string; size: number; digest: string | null; url: string };
export type GithubRelease = { tag: string; name: string | null; draft: boolean; prerelease: boolean; publishedAt: string | null; htmlUrl: string; body: string | null; assets: GithubAsset[] };
export type Semver = readonly [number, number, number];
export type InstallProbe = { platform: string; arch: string; channel: string; execPath: string; appImage: string | undefined; hasUninstaller: boolean };

// INV: these names are what .github/workflows/desktop.yml attaches to every release; the README links to the same names
export const ASSET_NAMES: Record<Exclude<InstallKind, "none">, string> = {
  windows: "BridgeToGrowthLearning-Setup-x64.exe",
  macos: "BridgeToGrowthLearning-macOS-arm64.dmg",
  deb: "BridgeToGrowthLearning-amd64.deb",
  appimage: "BridgeToGrowthLearning-x86_64.AppImage",
};
export const DEB_INSTALL_PREFIX = "/opt/BridgeToGrowthLearning/";
export const MAX_ASSET_BYTES = 600 * 1024 * 1024;
const MAX_NOTES = 4000;
const MAX_LISTED = 20;
const DOWNLOAD_HOSTS: ReadonlySet<string> = new Set(["github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com"]);

// O(n) in text length
// INV: only a plain x.y.z (optionally v-prefixed) is a version; a tag like v1.0.0-beta is never treated as stable
export function parseSemver(text: string): Semver | null {
  const m = /^v?(\d{1,6})\.(\d{1,6})\.(\d{1,6})$/.exec(text.trim());
  if (m === null) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

// O(1)
export function compareSemver(a: Semver, b: Semver): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

// O(1)
export function formatSemver(v: Semver): string {
  return `${v[0]}.${v[1]}.${v[2]}`;
}

// O(1)
// INV: only GitHub's "sha256:<64 hex>" form is accepted; anything else means no usable checksum
export function parseAssetDigest(digest: string | null): string | null {
  if (digest === null) return null;
  const m = /^sha256:([0-9a-f]{64})$/.exec(digest.trim().toLowerCase());
  return m === null ? null : (m[1] ?? null);
}

// O(1)
// INV: a stable-channel build is required; dev builds and unrecognised copies are "none"
// INV: Linux is an AppImage when the AppImage runtime set APPIMAGE, a .deb when it runs from the package's /opt folder; Windows is the setup wizard's install when its uninstaller sits in the install folder
export function installKindOf(p: InstallProbe): InstallKind {
  if (p.channel !== "stable") return "none";
  if (p.platform === "linux" && p.arch === "x64") {
    if (p.appImage !== undefined && p.appImage.startsWith("/") && p.appImage.endsWith(".AppImage")) return "appimage";
    if (p.execPath.startsWith(DEB_INSTALL_PREFIX)) return "deb";
    return "none";
  }
  if (p.platform === "win32" && p.hasUninstaller) return "windows";
  if (p.platform === "darwin" && p.arch === "arm64") return "macos";
  return "none";
}

// O(1)
// INV: an install downloads its own format; any other copy gets the portable or usual file for its OS, or null when no release is built for this OS and CPU
export function assetNameOf(platform: string, arch: string, kind: InstallKind): string | null {
  if (kind !== "none") return ASSET_NAMES[kind];
  if (platform === "linux" && arch === "x64") return ASSET_NAMES.appimage;
  if (platform === "win32" && (arch === "x64" || arch === "arm64")) return ASSET_NAMES.windows;
  if (platform === "darwin" && arch === "arm64") return ASSET_NAMES.macos;
  return null;
}

// O(1)
function relationOf(version: Semver, current: Semver | null): ReleaseRelation {
  if (current === null) return "newer";
  const order = compareSemver(version, current);
  return order > 0 ? "newer" : order === 0 ? "current" : "older";
}

// O(1)
function clipNotes(body: string | null): string {
  const text = (body ?? "").trim();
  return text.length <= MAX_NOTES ? text : `${text.slice(0, MAX_NOTES).trimEnd()}…`;
}

// O(n log n) in releases
// INV: drafts, prereleases and non-x.y.z tags are dropped; one entry per version (newest first, at most MAX_LISTED); a release keeps an asset only when it has the exact file for this machine
export function toReleaseList(releases: readonly GithubRelease[], current: string, assetName: string | null): ReleaseInfo[] {
  const currentVersion = parseSemver(current);
  const stable = releases
    .map((release) => ({ release, version: parseSemver(release.tag) }))
    .filter((entry): entry is { release: GithubRelease; version: Semver } => !entry.release.draft && !entry.release.prerelease && entry.version !== null)
    .sort((a, b) => compareSemver(b.version, a.version));
  const seen = new Set<string>();
  const out: ReleaseInfo[] = [];
  for (const { release, version } of stable) {
    const text = formatSemver(version);
    if (seen.has(text)) continue;
    seen.add(text);
    const asset = assetName === null ? undefined : release.assets.find((a) => a.name === assetName);
    out.push({
      tag: release.tag,
      version: text,
      name: release.name?.trim() || `Version ${text}`,
      publishedAt: release.publishedAt,
      notes: clipNotes(release.body),
      url: release.htmlUrl,
      asset: asset === undefined ? null : { name: asset.name, size: asset.size, checksum: parseAssetDigest(asset.digest) !== null },
      relation: relationOf(version, currentVersion),
    });
    if (out.length === MAX_LISTED) break;
  }
  return out;
}

// O(n) in releases
export function findReleaseAsset(releases: readonly GithubRelease[], tag: string, assetName: string): { release: GithubRelease; asset: GithubAsset } | null {
  const wanted = parseSemver(tag);
  if (wanted === null) return null;
  for (const release of releases) {
    const version = parseSemver(release.tag);
    if (release.draft || release.prerelease || version === null || compareSemver(version, wanted) !== 0) continue;
    const asset = release.assets.find((a) => a.name === assetName);
    if (asset !== undefined) return { release, asset };
  }
  return null;
}

// O(1)
// SEC: the first download hop must be this repository's own release download path on github.com
export function isReleaseAssetUrl(url: string, repo: string): boolean {
  const parsed = URL.parse(url);
  return parsed !== null && parsed.protocol === "https:" && parsed.hostname === "github.com" && parsed.port === "" && parsed.pathname.startsWith(`/${repo}/releases/download/`);
}

// O(1)
// SEC: every redirect hop must stay on GitHub's own download hosts, over https on the default port
export function isAllowedDownloadUrl(url: URL): boolean {
  return url.protocol === "https:" && url.port === "" && url.username === "" && url.password === "" && DOWNLOAD_HOSTS.has(url.hostname);
}

// O(1)
// INV: sortable, filesystem-safe, and names the version that wrote the data
export function backupFileName(version: string, now: Date): string {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return `btg-before-${version.replace(/[^0-9A-Za-z.]/g, "_")}-${stamp}.sqlite`;
}

// O(n log n) in names
// INV: only files this module wrote (btg-before-*.sqlite) are candidates; the newest `keep` survive
export function backupsToPrune(names: readonly string[], keep: number): string[] {
  const ours = names.filter((name) => /^btg-before-[0-9A-Za-z._]+-\d{8}T\d{6}Z\.sqlite$/.test(name));
  const byStamp = (name: string): string => name.slice(-23);
  return ours.sort((a, b) => byStamp(b).localeCompare(byStamp(a))).slice(Math.max(0, keep));
}
