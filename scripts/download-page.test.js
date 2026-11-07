import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  INSTALLERS,
  LATEST_API,
  LOCAL_PREVIEW_TAG,
  RELEASES_PAGE,
  applyPage,
  describePage,
  downloadUrl,
  formatSize,
  loadLatest,
  matchingIds,
  requestForLocation,
  viewFromResponse,
} from "../website/releases.js";

const root = join(import.meta.dir, "..");
const html = readFileSync(join(root, "website/index.html"), "utf8");
const pageJs = readFileSync(join(root, "website/releases.js"), "utf8");
const TAG = "v1.2.3";

function asset(file, extra = {}) {
  return {
    name: file,
    size: 4096,
    browser_download_url: `https://github.com/aaronilyas/BridgeToGrowth-Learning/releases/download/${TAG}/${file}`,
    ...extra,
  };
}

function releaseBody(assets, extra = {}) {
  return {
    tag_name: TAG,
    name: "BridgeToGrowth Learning 1.2.3",
    draft: false,
    prerelease: false,
    published_at: "2026-03-15T00:00:00Z",
    assets,
    ...extra,
  };
}

function hrefs(view) {
  return describePage(view).cards.map((card) => card.href);
}

test("the page lists only the four installers the desktop workflow publishes", () => {
  expect(INSTALLERS.map((item) => item.file)).toEqual([
    "BridgeToGrowthLearning-Setup-x64.exe",
    "BridgeToGrowthLearning-macOS-arm64.dmg",
    "BridgeToGrowthLearning-amd64.deb",
    "BridgeToGrowthLearning-x86_64.AppImage",
  ]);
  expect(INSTALLERS.map((item) => item.osLabel)).toEqual([
    "Windows 10 or 11 (64-bit)",
    "macOS on Apple silicon (arm64)",
    "Ubuntu, Debian, and Linux Mint (64-bit amd64)",
    "Other Linux (64-bit x86_64)",
  ]);
  expect(pageJs).not.toContain("0.1.0");
  expect(html).not.toContain("0.1.0");
});

test("static markup has no download links and names every installer", () => {
  expect(html).not.toContain("/releases/download/");
  expect(html).not.toContain("/releases/latest/");
  expect(html).toContain(`href="${RELEASES_PAGE}"`);
  expect(html).toContain('id="releases-fallback"');
  expect(html).toContain('href="#downloads"');
  expect(html).toContain('role="status"');
  for (const item of INSTALLERS) {
    expect(html).toContain(`data-installer="${item.id}"`);
    expect(html).toContain(item.file);
    const slot = html.split(`data-installer="${item.id}"`)[1]?.split("</article>")[0] ?? "";
    expect(slot).toContain("<button");
    expect(slot).toContain("disabled");
    expect(slot).not.toContain("<a");
    expect(slot).not.toContain('href="http');
  }
  expect(html).not.toMatch(/src="https?:/);
  expect(html).not.toMatch(/href="http:\/\//);
  expect(readFileSync(join(root, "website/CNAME"), "utf8")).toBe("bridgetogrowth-learning.com\n");
});

test("a missing stable release leaves every download disabled", () => {
  const view = viewFromResponse(404, { message: "Not Found" });
  const page = describePage(view);
  expect(view.kind).toBe("empty");
  expect(page.status).toContain("No stable release");
  expect(page.status).toContain("pre-releases");
  expect(page.status).not.toContain("0.1.0");
  expect(page.version).toBeNull();
  expect(page.cards.every((card) => card.href === null && card.action === "Download unavailable")).toBe(true);
});

test("drafts and pre-releases are not offered even when they have assets", () => {
  const assets = INSTALLERS.map((item) => asset(item.file));
  expect(viewFromResponse(200, releaseBody(assets, { draft: true, prerelease: false })).kind).toBe("empty");
  expect(viewFromResponse(200, releaseBody(assets, { draft: false, prerelease: true })).kind).toBe("empty");
  expect(hrefs(viewFromResponse(200, releaseBody(assets, { draft: true }))).every((href) => href === null)).toBe(true);
});

test("a stable release enables only the assets it actually contains", () => {
  const full = viewFromResponse(200, releaseBody(INSTALLERS.map((item) => asset(item.file, { size: 52_428_800 }))));
  expect(full.kind).toBe("ready");
  expect(full.release.tag).toBe(TAG);
  expect(full.release.published).toBe("March 15, 2026");
  const page = describePage(full);
  expect(page.status).toContain(TAG);
  expect(page.status).not.toContain("0.1.0");
  expect(page.version.href).toBe(`https://github.com/aaronilyas/BridgeToGrowth-Learning/releases/tag/${TAG}`);
  expect(page.cards.map((card) => card.href)).toEqual(INSTALLERS.map((item) => downloadUrl(TAG, item.file, asset(item.file).browser_download_url)));
  expect(page.cards.every((card) => card.action === "Download" && card.meta === "50 MB")).toBe(true);

  const partial = describePage(viewFromResponse(200, releaseBody([asset(INSTALLERS[0].file)])));
  expect(partial.cards[0].href).toContain("BridgeToGrowthLearning-Setup-x64.exe");
  expect(partial.cards.slice(1).every((card) => card.href === null && card.action === "Not in this release")).toBe(true);

  const none = describePage(viewFromResponse(200, releaseBody([])));
  expect(none.kind).toBe("ready");
  expect(none.cards.every((card) => card.href === null && card.action === "Not in this release")).toBe(true);
});

test("download URLs that are not this repository's release assets are dropped", () => {
  const file = INSTALLERS[0].file;
  const good = `https://github.com/aaronilyas/BridgeToGrowth-Learning/releases/download/${TAG}/${file}`;
  expect(downloadUrl(TAG, file, good)).toBe(good);
  const rejected = [
    good.replace("https://", "http://"),
    `https://evil.example/releases/download/${TAG}/${file}`,
    `https://github.com/other/BridgeToGrowth-Learning/releases/download/${TAG}/${file}`,
    `https://github.com/aaronilyas/BridgeToGrowth-Learning/releases/latest/download/${file}`,
    `https://github.com/aaronilyas/BridgeToGrowth-Learning/releases/download/v9.9.9/${file}`,
    `https://github.com/aaronilyas/BridgeToGrowth-Learning/releases/download/${TAG}/other.exe`,
    `${good}?evil=1`,
    `https://user:pass@github.com/aaronilyas/BridgeToGrowth-Learning/releases/download/${TAG}/${file}`,
    `javascript:${file}`,
  ];
  for (const candidate of rejected) expect(downloadUrl(TAG, file, candidate)).toBeNull();

  const poisoned = viewFromResponse(200, releaseBody([
    asset(file, { browser_download_url: "https://evil.example/setup.exe" }),
    asset(file),
  ]));
  expect(describePage(poisoned).cards[0].href).toBe(good);
  const firstWins = viewFromResponse(200, releaseBody([
    asset(file, { size: 10 }),
    asset(file, { browser_download_url: "https://evil.example/setup.exe", size: 99 }),
  ]));
  expect(describePage(firstWins).cards[0].href).toBe(good);
  expect(describePage(firstWins).cards[0].meta).toBe("10 B");
});

test("an unreadable GitHub response keeps the buttons off", () => {
  expect(viewFromResponse(500, { message: "nope" }).kind).toBe("error");
  expect(viewFromResponse(403, { message: "rate limit" }).kind).toBe("error");
  expect(viewFromResponse(200, null).kind).toBe("error");
  expect(viewFromResponse(200, []).kind).toBe("error");
  expect(viewFromResponse(200, releaseBody(INSTALLERS.map((item) => asset(item.file)), { draft: undefined, prerelease: false })).kind).toBe("error");
  expect(viewFromResponse(200, releaseBody([], { tag_name: "v1" })).kind).toBe("error");
  expect(viewFromResponse(200, releaseBody([], { tag_name: "v1.2.3/extra" })).kind).toBe("error");
  const page = describePage(viewFromResponse(403, { message: "rate limit" }));
  expect(page.status).toContain("could not be loaded");
  expect(page.status).toContain("releases page");
  expect(page.cards.every((card) => card.href === null)).toBe(true);
});

test("loadLatest reports empty, failure, and a stable release without inventing a version", async () => {
  const empty = await loadLatest(async () => ({ status: 404, text: async () => JSON.stringify({ message: "Not Found" }) }), { apiUrl: LATEST_API, preview: null });
  expect(empty.kind).toBe("empty");
  expect(describePage(empty).status).not.toMatch(/v\d/);

  const offline = await loadLatest(async () => { throw new Error("offline"); }, { apiUrl: LATEST_API, preview: null });
  expect(offline.kind).toBe("error");

  const broken = await loadLatest(async () => ({ status: 200, text: async () => "not-json" }), { apiUrl: LATEST_API, preview: null });
  expect(broken.kind).toBe("error");

  let requested = "";
  const ready = await loadLatest(async (url, init) => {
    requested = `${url} ${init.headers.Accept}`;
    return { status: 200, text: async () => JSON.stringify(releaseBody([asset(INSTALLERS[2].file)])) };
  }, { apiUrl: LATEST_API, preview: null });
  expect(requested).toContain(LATEST_API);
  expect(requested).toContain("application/vnd.github+json");
  expect(ready.release.tag).toBe(TAG);
  expect(describePage(ready).cards.filter((card) => card.href).map((card) => card.file)).toEqual(["BridgeToGrowthLearning-amd64.deb"]);
});

test("preview modes stay on loopback and still refuse a bad asset", async () => {
  expect(requestForLocation(new URL("https://bridgetogrowth-learning.com/?preview=release")).preview).toBeNull();
  expect(requestForLocation(new URL("https://www.bridgetogrowth-learning.com/?preview=error")).preview).toBeNull();
  expect(requestForLocation(new URL("https://aaronilyas.github.io/BridgeToGrowth-Learning/index.html?preview=release")).preview).toBeNull();
  expect(requestForLocation(new URL("http://0.0.0.0/?preview=release")).preview).toBeNull();
  expect(requestForLocation(new URL("http://127.0.0.1:4173/?preview=release")).preview).toBe("release");
  expect(requestForLocation(new URL("http://[::1]/?preview=empty")).preview).toBe("empty");
  expect(requestForLocation(new URL("http://localhost/?preview=nope")).preview).toBeNull();

  const release = await loadLatest(async () => { throw new Error("network must not be used"); }, { apiUrl: LATEST_API, preview: "release" });
  const described = describePage(release);
  expect(release.preview).toBe("release");
  expect(described.previewNote).toContain("not a published version");
  expect(described.status).toContain(LOCAL_PREVIEW_TAG);
  expect(described.cards.every((card) => card.href?.includes(LOCAL_PREVIEW_TAG))).toBe(true);

  const failed = await loadLatest(async () => { throw new Error("unused"); }, { apiUrl: LATEST_API, preview: "error" });
  expect(failed.kind).toBe("error");
  expect(describePage(failed).previewNote).toContain("API failure");
  expect(describePage(failed).cards.every((card) => card.href === null)).toBe(true);

  const absent = await loadLatest(async () => { throw new Error("unused"); }, { apiUrl: LATEST_API, preview: "empty" });
  expect(absent.kind).toBe("empty");
  expect(describePage(absent).previewNote).toContain("empty-release");
});

test("the current computer is matched only to an installer that exists for it", () => {
  expect(matchingIds("Mozilla/5.0 (Windows NT 10.0; Win64; x64)", "Windows", "x86")).toEqual(["windows"]);
  expect(matchingIds("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", "macOS", "arm")).toEqual(["macos"]);
  expect(matchingIds("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", "macOS", "x86")).toEqual([]);
  expect(matchingIds("Mozilla/5.0 (Macintosh)", "MacIntel", null)).toEqual([]);
  expect(matchingIds("Mozilla/5.0 (X11; Linux x86_64)", "Linux", "x86")).toEqual([]);
  expect(matchingIds("Mozilla/5.0 (Linux; Android 14)", "Linux", "arm")).toEqual([]);
  expect(matchingIds("Mozilla/5.0 (iPad)", "MacIntel", "arm")).toEqual([]);
  expect(matchingIds("Mozilla/5.0 (CrOS x86_64 14541.0.0)", "Chrome OS", null)).toEqual([]);
  const page = describePage(viewFromResponse(404, {}), ["windows"]);
  expect(page.cards.map((card) => card.matches)).toEqual([true, false, false, false]);
});

test("file sizes use binary units and skip values that are not a size", () => {
  expect(formatSize(0)).toBe("0 B");
  expect(formatSize(1023)).toBe("1023 B");
  expect(formatSize(1024)).toBe("1.0 KB");
  expect(formatSize(1536)).toBe("1.5 KB");
  expect(formatSize(10 * 1024)).toBe("10 KB");
  expect(formatSize(52_428_800)).toBe("50 MB");
  expect(formatSize(-1)).toBeNull();
  expect(formatSize(Number.NaN)).toBeNull();
});

function node(tag) {
  const item = {
    tag,
    hidden: false,
    className: "",
    attrs: {},
    disabled: false,
    type: "",
    children: [],
    _text: "",
    setAttribute(name, value) { this.attrs[name] = String(value); },
    append(...kids) { this.children.push(...kids); },
    replaceChildren(...kids) { this.children = [...kids]; this._text = ""; },
    querySelector(selector) { return find(this, selector); },
  };
  Object.defineProperty(item, "textContent", {
    get() {
      if (this.children.length === 0) return this._text;
      return this.children.map((child) => child.textContent ?? "").join("");
    },
    set(value) {
      this._text = String(value);
      this.children = [];
    },
  });
  return item;
}

function find(item, selector) {
  if (selector.startsWith(".")) {
    const name = selector.slice(1);
    if ((item.className ?? "").split(/\s+/).includes(name)) return item;
  }
  const attr = /^\[data-installer="([^"]+)"\]$/.exec(selector);
  if (attr && item.attrs["data-installer"] === attr[1]) return item;
  for (const child of item.children ?? []) {
    const found = find(child, selector);
    if (found) return found;
  }
  return null;
}

function fakeDocument() {
  const status = node("p");
  const note = node("p");
  const version = node("p");
  const cards = INSTALLERS.map((item) => {
    const root = node("article");
    root.attrs["data-installer"] = item.id;
    const badge = node("p");
    badge.className = "match";
    badge.hidden = true;
    const slot = node("div");
    slot.className = "download-slot";
    const size = node("span");
    size.className = "size";
    root.children.push(badge, slot, size);
    return root;
  });
  return {
    doc: {
      getElementById(id) {
        if (id === "release-status") return status;
        if (id === "preview-note") return note;
        if (id === "release-version") return version;
        return null;
      },
      querySelector(selector) {
        for (const card of cards) {
          const found = find(card, selector);
          if (found) return found;
        }
        return null;
      },
      createElement: node,
      createTextNode(value) { return { textContent: String(value), children: [] }; },
    },
    status,
    note,
    version,
    cards,
  };
}

test("applying a view never leaves an enabled link without a checked asset URL", () => {
  const empty = fakeDocument();
  applyPage(empty.doc, describePage(viewFromResponse(404, { message: "Not Found" })));
  expect(empty.status.attrs["aria-busy"]).toBe("false");
  expect(empty.note.hidden).toBe(true);
  for (const card of empty.cards) {
    const control = card.querySelector(".download-slot").children[0];
    expect(control.tag).toBe("button");
    expect(control.disabled).toBe(true);
    expect(control.attrs.href).toBeUndefined();
  }

  const failed = fakeDocument();
  applyPage(failed.doc, describePage({ kind: "error", preview: "error", release: null }));
  expect(failed.status.textContent).toContain("could not be loaded");
  expect(failed.note.hidden).toBe(false);
  expect(failed.note.textContent).toContain("API failure");
  expect(failed.cards.every((card) => card.querySelector(".download-slot").children[0].tag === "button")).toBe(true);

  const ready = fakeDocument();
  applyPage(ready.doc, describePage(viewFromResponse(200, releaseBody(INSTALLERS.map((item) => asset(item.file)))), ["linux-deb", "linux-appimage"]));
  expect(ready.version.textContent).toContain("BridgeToGrowth Learning 1.2.3");
  expect(ready.version.textContent).toContain("March 15, 2026");
  expect(ready.version.children[0].attrs.href).toBe("https://github.com/aaronilyas/BridgeToGrowth-Learning/releases/tag/v1.2.3");
  const links = ready.cards.map((card) => card.querySelector(".download-slot").children[0]);
  expect(links.every((link) => link.tag === "a" && link.attrs.href.startsWith("https://github.com/aaronilyas/BridgeToGrowth-Learning/releases/download/v1.2.3/"))).toBe(true);
  expect(links[0].attrs["aria-label"]).toContain("BridgeToGrowthLearning-Setup-x64.exe");
  expect(ready.cards.map((card) => card.querySelector(".match").hidden)).toEqual([true, true, false, false]);
});

test("the pages workflow publishes the website directory and does not create a release", () => {
  const workflow = readFileSync(join(root, ".github/workflows/pages.yml"), "utf8");
  expect(workflow).toContain("actions/deploy-pages@368f82528645a54fb793d4d04e342629a3f51346");
  expect(workflow).toContain("actions/upload-pages-artifact@fc324d3547104276b827a68afc52ff2a11cc49c9");
  expect(workflow).toContain("actions/configure-pages@45bfe0192ca1faeb007ade9deae92b16b8254a0d");
  expect(workflow).toContain("path: website");
  expect(workflow).toContain("pages: write");
  expect(workflow).toContain("id-token: write");
  expect(workflow).toContain("refs/heads/main");
  expect(workflow).not.toContain("gh release");
  expect(workflow).not.toContain("softprops/action-gh-release");
});
