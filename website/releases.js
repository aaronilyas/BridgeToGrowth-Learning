// Resolves the latest stable GitHub release into download buttons.
// A button is enabled only when this payload names that installer and its URL
// is an https download on this repository. Drafts, pre-releases, and anything
// that cannot be verified stay disabled. Local preview modes never apply on a public host.

export const REPO = "aaronilyas/BridgeToGrowth-Learning";
export const RELEASES_PAGE = `https://github.com/${REPO}/releases`;
export const LATEST_API = `https://api.github.com/repos/${REPO}/releases/latest`;
export const LOCAL_PREVIEW_TAG = "v0.0.0-local-preview";

// Filenames published by .github/workflows/desktop.yml. Intel Mac and ARM Linux are not in that matrix.
export const INSTALLERS = [
  {
    id: "windows",
    os: "Windows",
    osLabel: "Windows 10 or 11 (64-bit)",
    arch: "64-bit (x64)",
    file: "BridgeToGrowthLearning-Setup-x64.exe",
  },
  {
    id: "macos",
    os: "macOS",
    osLabel: "macOS on Apple silicon (arm64)",
    arch: "Apple silicon (arm64)",
    file: "BridgeToGrowthLearning-macOS-arm64.dmg",
  },
  {
    id: "linux-deb",
    os: "Linux",
    osLabel: "Ubuntu, Debian, and Linux Mint (64-bit amd64)",
    arch: "64-bit (amd64)",
    file: "BridgeToGrowthLearning-amd64.deb",
  },
  {
    id: "linux-appimage",
    os: "Linux",
    osLabel: "Other Linux (64-bit x86_64)",
    arch: "64-bit (x86_64)",
    file: "BridgeToGrowthLearning-x86_64.AppImage",
  },
];

const WANTED = new Set(INSTALLERS.map((item) => item.file));
// Browsers report the IPv6 loopback host as "::1". Bun's URL parser keeps the brackets.
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const PREVIEWS = new Set(["empty", "error", "release", "partial"]);
// Tags published by the desktop workflow are v plus the app's major.minor.patch.
// The local preview suffix is accepted so the fixture goes through the same checks.
const TAG_PATTERN = /^v\d+\.\d+\.\d+(?:-local-preview)?$/;

const PREVIEW_NOTES = {
  empty: "Local preview of the empty-release state. This is not the live GitHub response.",
  error: "Local preview of an API failure. This is not the live GitHub response.",
  release: "Local preview of a stable release. These links are examples on this computer only. They are not a published version.",
  partial: "Local preview of a release that is missing some installers. These links are examples on this computer only. They are not a published version.",
};

// O(1)
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// O(1)
function emptyView() {
  return { kind: "empty", preview: null, release: null };
}

// O(1)
function errorView() {
  return { kind: "error", preview: null, release: null };
}

// O(1). Bytes from the release asset. Null when the payload has no usable size.
export function formatSize(bytes) {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes < 0) return null;
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  const digits = unit === 0 || size >= 10 ? 0 : 1;
  const label = unit === 0 ? String(Math.round(size)) : size.toFixed(digits);
  return `${label} ${units[unit]}`;
}

// O(1)
function formatPublished(value) {
  if (typeof value !== "string") return null;
  const time = Date.parse(value);
  if (Number.isNaN(time)) return null;
  return new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: "UTC" }).format(time);
}

// O(1). Rebuilds the URL so a lookalike host or an extra path segment cannot be forwarded.
export function downloadUrl(tag, file, candidate) {
  if (typeof candidate !== "string" || typeof tag !== "string" || typeof file !== "string") return null;
  let url;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.hostname !== "github.com") return null;
  if (url.username || url.password || url.port || url.search || url.hash) return null;
  const parts = url.pathname.split("/");
  if (parts.length !== 7 || parts[0] !== "") return null;
  if (parts[1] !== "aaronilyas" || parts[2] !== "BridgeToGrowth-Learning") return null;
  if (parts[3] !== "releases" || parts[4] !== "download") return null;
  let urlTag = "";
  let urlFile = "";
  try {
    urlTag = decodeURIComponent(parts[5] ?? "");
    urlFile = decodeURIComponent(parts[6] ?? "");
  } catch {
    return null;
  }
  if (urlTag !== tag || urlFile !== file) return null;
  return `https://github.com/${REPO}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(file)}`;
}

// O(assets)
function filesFromAssets(tag, assets) {
  if (!Array.isArray(assets)) return null;
  const files = Object.create(null);
  for (const asset of assets) {
    if (!isRecord(asset) || typeof asset.name !== "string" || !WANTED.has(asset.name)) continue;
    if (Object.hasOwn(files, asset.name)) continue;
    const href = downloadUrl(tag, asset.name, asset.browser_download_url);
    if (!href) continue;
    const size = typeof asset.size === "number" && Number.isFinite(asset.size) && asset.size >= 0 ? asset.size : null;
    files[asset.name] = { href, size };
  }
  return files;
}

// O(assets). 404 is a confirmed absence. A draft or pre-release is not offered.
// Any other shape is a failure: the buttons stay off rather than guessing a file.
export function viewFromResponse(status, body) {
  if (status === 404) return emptyView();
  if (status !== 200 || !isRecord(body)) return errorView();
  if (body.draft === true || body.prerelease === true) return emptyView();
  if (body.draft !== false || body.prerelease !== false) return errorView();
  if (typeof body.tag_name !== "string" || !TAG_PATTERN.test(body.tag_name) || body.tag_name.includes("..")) return errorView();
  const files = filesFromAssets(body.tag_name, body.assets);
  if (!files) return errorView();
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const label = name && name.length <= 120 && !name.includes("\n") && !name.includes("\r")
    ? name
    : `BridgeToGrowth Learning ${body.tag_name}`;
  return {
    kind: "ready",
    preview: null,
    release: {
      tag: body.tag_name,
      label,
      url: `https://github.com/${REPO}/releases/tag/${encodeURIComponent(body.tag_name)}`,
      published: formatPublished(body.published_at),
      files,
    },
  };
}

// O(1). Preview responses are fixtures. They are selected only for a loopback host.
function previewPayload(preview) {
  const asset = (file, size) => ({
    name: file,
    size,
    browser_download_url: downloadUrl(LOCAL_PREVIEW_TAG, file, `https://github.com/${REPO}/releases/download/${LOCAL_PREVIEW_TAG}/${file}`),
  });
  if (preview === "empty") return { status: 404, body: { message: "Not Found" } };
  if (preview === "error") return { status: 503, body: { message: "local preview" } };
  const release = {
    tag_name: LOCAL_PREVIEW_TAG,
    name: "Local preview fixture",
    draft: false,
    prerelease: false,
    published_at: "2026-01-15T00:00:00Z",
    assets: preview === "partial"
      ? [asset(INSTALLERS[0].file, 82_000_000)]
      : INSTALLERS.map((item, index) => asset(item.file, (80 + index) * 1_000_000)),
  };
  return { status: 200, body: release };
}

// O(1). The public site always uses the live latest-release API, including when a preview query is present.
export function requestForLocation(url) {
  const requested = url.searchParams.get("preview");
  const preview = LOCAL_HOSTS.has(url.hostname) && requested && PREVIEWS.has(requested) ? requested : null;
  return { apiUrl: LATEST_API, preview };
}

// O(assets)
export async function loadLatest(fetchImpl, request) {
  if (request.preview) {
    const simulated = previewPayload(request.preview);
    return { ...viewFromResponse(simulated.status, simulated.body), preview: request.preview };
  }
  try {
    const response = await fetchImpl(request.apiUrl, {
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    const text = await response.text();
    let body = null;
    if (text) body = JSON.parse(text);
    return viewFromResponse(response.status, body);
  } catch {
    return errorView();
  }
}

// O(1). Highlights a card only when the computer can use that published installer.
export function matchingIds(userAgent, platform, architecture) {
  const blob = `${userAgent} ${platform}`.toLowerCase();
  if (blob.includes("android") || blob.includes("cros") || blob.includes("ipad") || blob.includes("iphone")) return [];
  if (blob.includes("windows") || blob.includes("win32") || blob.includes("win64")) return ["windows"];
  if (blob.includes("mac")) {
    if (architecture === "arm" || architecture === "arm64") return ["macos"];
    return [];
  }
  // Linux has two installers, and the browser cannot tell Debian-family from the rest.
  return [];
}

// O(installers)
function statusText(view) {
  if (view.kind === "loading") return "Checking the latest stable release…";
  if (view.kind === "empty") {
    return "No stable release is published yet. Drafts and pre-releases are not listed here. A download button turns on only when a stable release includes that installer.";
  }
  if (view.kind === "error") {
    return "The latest release could not be loaded from GitHub, so the download buttons are off. Open the releases page to check there.";
  }
  const release = view.release;
  const dated = release.published ? `, published ${release.published}` : "";
  return `Latest stable release ${release.tag}${dated}. A download button is on only when this release includes that installer. Drafts and pre-releases are not used.`;
}

// O(installers)
export function describePage(view, matchIds = []) {
  const matches = new Set(matchIds);
  const files = view.release ? view.release.files : Object.create(null);
  return {
    kind: view.kind,
    status: statusText(view),
    previewNote: view.preview ? PREVIEW_NOTES[view.preview] ?? "" : "",
    version: view.release
      ? { href: view.release.url, label: view.release.label, published: view.release.published }
      : null,
    cards: INSTALLERS.map((item) => {
      const file = Object.hasOwn(files, item.file) ? files[item.file] : null;
      const href = view.kind === "ready" && file ? file.href : null;
      let action = "Download unavailable";
      if (href) action = "Download";
      else if (view.kind === "ready") action = "Not in this release";
      return {
        id: item.id,
        file: item.file,
        osLabel: item.osLabel,
        href,
        action,
        meta: href && file && file.size !== null ? formatSize(file.size) ?? "" : "",
        matches: matches.has(item.id),
      };
    }),
  };
}

// O(installers). Writes text and attributes only. Href values come from describePage, which already checked them.
export function applyPage(doc, description) {
  const status = doc.getElementById("release-status");
  const note = doc.getElementById("preview-note");
  const version = doc.getElementById("release-version");
  if (!status || !note || !version) throw new Error("download page is missing its status region");
  status.textContent = description.status;
  status.setAttribute("aria-busy", description.kind === "loading" ? "true" : "false");
  note.hidden = description.previewNote === "";
  note.textContent = description.previewNote;
  version.replaceChildren();
  if (description.version) {
    const link = doc.createElement("a");
    link.setAttribute("href", description.version.href);
    link.textContent = description.version.label;
    version.append(link);
    if (description.version.published) version.append(doc.createTextNode(` (${description.version.published})`));
  }
  for (const card of description.cards) {
    const root = doc.querySelector(`[data-installer="${card.id}"]`);
    const slot = root?.querySelector(".download-slot");
    const size = root?.querySelector(".size");
    const badge = root?.querySelector(".match");
    if (!root || !slot || !size || !badge) throw new Error(`download page is missing the ${card.id} card`);
    badge.hidden = !card.matches;
    size.textContent = card.meta ? ` · ${card.meta}` : "";
    slot.replaceChildren();
    if (card.href) {
      const link = doc.createElement("a");
      link.className = "download";
      link.setAttribute("href", card.href);
      link.textContent = "Download";
      link.setAttribute("aria-label", `Download ${card.file} for ${card.osLabel}`);
      slot.append(link);
    } else {
      const button = doc.createElement("button");
      button.type = "button";
      button.disabled = true;
      button.textContent = card.action;
      button.setAttribute("aria-label", `${card.action}. ${card.file} for ${card.osLabel}`);
      slot.append(button);
    }
  }
}
