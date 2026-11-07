// Loads the static download page in headless Chrome and checks the live GitHub response
// plus the loopback preview modes. Writes full-page screenshots when a directory is passed:
//   bun scripts/check-download-page.ts /tmp/btg-download-page
import { type ChildProcess, spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join, normalize, sep } from "node:path";

const ROOT = join(import.meta.dir, "..", "website");
const FILES = [
  "BridgeToGrowthLearning-Setup-x64.exe",
  "BridgeToGrowthLearning-macOS-arm64.dmg",
  "BridgeToGrowthLearning-amd64.deb",
  "BridgeToGrowthLearning-x86_64.AppImage",
];
const PREVIEW_TAG = "v0.0.0-local-preview";

type PageState = {
  state: string;
  status: string;
  preview: string;
  previewHidden: boolean;
  links: string[];
  disabled: number;
  fallback: boolean;
  rendered: boolean;
};

type Cdp = {
  send(method: string, params?: Record<string, unknown>): Promise<unknown>;
  close(): void;
};

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
};

function contentType(file: string): string {
  return TYPES[extname(file)] ?? "application/octet-stream";
}

function resolveFile(urlPath: string): string | null {
  const pathname = urlPath.split("?")[0] ?? "/";
  let decoded = pathname;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const relative = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
  if (relative.includes("\0")) return null;
  const full = normalize(join(ROOT, relative));
  if (full !== ROOT && !full.startsWith(`${ROOT}${sep}`)) return null;
  return full;
}

function serve(): Promise<{ port: number; close: () => Promise<void> }> {
  const server: Server = createServer((req, res) => {
    const file = resolveFile(req.url ?? "/");
    if (!file) {
      res.writeHead(400);
      res.end();
      return;
    }
    readFile(file).then(
      (body) => {
        res.writeHead(200, { "content-type": contentType(file) });
        res.end(body);
      },
      () => {
        res.writeHead(404);
        res.end();
      },
    );
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("could not bind the preview server"));
        return;
      }
      resolve({
        port: address.port,
        close: () => new Promise((done, fail) => server.close((error) => (error ? fail(error) : done()))),
      });
    });
  });
}

function connect(wsUrl: string): Promise<Cdp> {
  const ws = new WebSocket(wsUrl);
  return new Promise((resolve, reject) => {
    const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
    let next = 0;
    ws.addEventListener("error", () => reject(new Error(`devtools socket failed for ${wsUrl}`)));
    ws.addEventListener("open", () => {
      ws.addEventListener("message", (event: MessageEvent) => {
        const data = JSON.parse(String(event.data)) as { id?: number; result?: unknown; error?: { message?: string } };
        if (typeof data.id !== "number") return;
        const waiter = pending.get(data.id);
        if (!waiter) return;
        pending.delete(data.id);
        if (data.error) waiter.reject(new Error(data.error.message ?? "devtools error"));
        else waiter.resolve(data.result);
      });
      resolve({
        send(method, params) {
          const id = ++next;
          return new Promise((res, rej) => {
            pending.set(id, { resolve: res, reject: rej });
            ws.send(JSON.stringify(params === undefined ? { id, method } : { id, method, params }));
          });
        },
        close() {
          ws.close();
        },
      });
    });
  });
}

async function waitForPort(dir: string): Promise<number> {
  const file = join(dir, "DevToolsActivePort");
  const started = Date.now();
  for (;;) {
    try {
      const text = await readFile(file, "utf8");
      const port = Number((text.split("\n")[0] ?? "").trim());
      if (Number.isInteger(port) && port > 0) return port;
    } catch {
      // Chrome creates the file after startup.
    }
    if (Date.now() - started > 10000) throw new Error("Chrome did not open a debugging port");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function launchChrome(userDataDir: string): Promise<ChildProcess> {
  const proc = spawn("google-chrome", [
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--remote-debugging-port=0",
    `--user-data-dir=${userDataDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "about:blank",
  ], { stdio: "ignore" });
  return proc;
}

async function evaluate(page: Cdp, expression: string): Promise<unknown> {
  const result = await page.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }) as {
    result?: { value?: unknown };
    exceptionDetails?: { text?: string; exception?: { description?: string } };
  };
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? "page script failed");
  }
  return result.result?.value;
}

async function waitForState(page: Cdp): Promise<void> {
  const started = Date.now();
  for (;;) {
    const value = await evaluate(page, "document.documentElement.dataset.releaseState || ''");
    if (typeof value === "string" && value !== "" && value !== "loading") return;
    if (Date.now() - started > 20000) throw new Error(`timed out waiting for the download page (last state: ${String(value)})`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

const SNAPSHOT = `(() => {
  const links = [...document.querySelectorAll("a.download")].map((anchor) => anchor.getAttribute("href") || "");
  const note = document.querySelector("#preview-note");
  const fallback = document.querySelector("#releases-fallback");
  return {
    state: document.documentElement.dataset.releaseState || "",
    status: document.querySelector("#release-status")?.textContent || "",
    preview: note?.textContent || "",
    previewHidden: note ? note.hidden : true,
    links,
    disabled: document.querySelectorAll(".download-slot button[disabled]").length,
    fallback: fallback?.getAttribute("href") === "https://github.com/aaronilyas/BridgeToGrowth-Learning/releases",
    rendered: (document.body.innerText || "").includes("Unsigned installers"),
  };
})()`;

function asState(value: unknown): PageState {
  if (typeof value !== "object" || value === null) throw new Error("page snapshot was empty");
  const record = value as Partial<PageState>;
  if (typeof record.state !== "string" || typeof record.status !== "string" || !Array.isArray(record.links)) {
    throw new Error("page snapshot was incomplete");
  }
  return {
    state: record.state,
    status: record.status,
    preview: record.preview ?? "",
    previewHidden: record.previewHidden === true,
    links: record.links.filter((item): item is string => typeof item === "string"),
    disabled: record.disabled ?? 0,
    fallback: record.fallback === true,
    rendered: record.rendered === true,
  };
}

function assertCommon(page: PageState, label: string): void {
  if (!page.rendered) throw new Error(`${label}: the page did not render`);
  if (!page.fallback) throw new Error(`${label}: the GitHub releases fallback link is missing`);
  if (page.links.length + page.disabled !== 4) throw new Error(`${label}: expected 4 installer controls, saw ${page.links.length} links and ${page.disabled} disabled buttons`);
}

async function openPage(browser: Cdp, port: number, url: string, width: number, mobile: boolean): Promise<{ page: Cdp; targetId: string; state: PageState }> {
  const created = await browser.send("Target.createTarget", { url: "about:blank" }) as { targetId?: string };
  if (!created.targetId) throw new Error("Chrome did not create a page");
  const list = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json()) as Array<{ id?: string; webSocketDebuggerUrl?: string }>;
  const socket = list.find((item) => item.id === created.targetId)?.webSocketDebuggerUrl;
  if (!socket) throw new Error("Chrome page has no debugging socket");
  const page = await connect(socket);
  await page.send("Page.enable");
  await page.send("Runtime.enable");
  await page.send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile });
  await page.send("Page.navigate", { url });
  await waitForState(page);
  const state = asState(await evaluate(page, SNAPSHOT));
  return { page, targetId: created.targetId, state };
}

async function screenshot(page: Cdp, file: string, width: number): Promise<void> {
  const size = await evaluate(page, "({width: Math.ceil(document.documentElement.scrollWidth), height: Math.ceil(document.documentElement.scrollHeight)})") as { width?: number; height?: number } | undefined;
  const shotWidth = Math.max(width, size?.width ?? width);
  const shotHeight = Math.max(900, size?.height ?? 900);
  const shot = await page.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: true,
    clip: { x: 0, y: 0, width: shotWidth, height: shotHeight, scale: 1 },
  }) as { data?: string };
  if (!shot.data) throw new Error(`Chrome did not return a screenshot for ${file}`);
  await writeFile(file, Buffer.from(shot.data, "base64"));
}

function assertLive(page: PageState): void {
  assertCommon(page, "live");
  if (!page.previewHidden || page.preview !== "") throw new Error("live page showed the local preview banner");
  if (page.state === "empty") {
    if (page.links.length !== 0 || !page.status.includes("No stable release")) throw new Error(page.status);
    return;
  }
  if (page.state === "error") {
    if (page.links.length !== 0 || !page.status.includes("could not be loaded")) throw new Error(page.status);
    return;
  }
  if (page.state !== "ready") throw new Error(`unexpected live state ${page.state}`);
  for (const href of page.links) {
    const match = /^https:\/\/github\.com\/aaronilyas\/BridgeToGrowth-Learning\/releases\/download\/v\d+\.\d+\.\d+\/([^/]+)$/.exec(href);
    const file = match?.[1];
    if (!file || !FILES.includes(file)) throw new Error(`live page linked an unexpected file: ${href}`);
  }
}

function assertEmptyPreview(page: PageState): void {
  assertCommon(page, "empty preview");
  if (page.state !== "empty" || page.links.length !== 0) throw new Error("empty preview enabled a download");
  if (!page.status.includes("No stable release")) throw new Error(page.status);
  if (!page.preview.includes("empty-release")) throw new Error(page.preview);
}

function assertErrorPreview(page: PageState): void {
  assertCommon(page, "error preview");
  if (page.state !== "error" || page.links.length !== 0) throw new Error("API-failure preview enabled a download");
  if (!page.status.includes("could not be loaded")) throw new Error(page.status);
  if (!page.preview.includes("API failure")) throw new Error(page.preview);
}

function assertReleasePreview(page: PageState): void {
  assertCommon(page, "release preview");
  if (page.state !== "ready" || page.disabled !== 0) throw new Error("release preview did not enable every installer");
  if (!page.preview.includes("not a published version")) throw new Error(page.preview);
  if (!page.status.includes(PREVIEW_TAG)) throw new Error(page.status);
  for (const file of FILES) {
    const href = `https://github.com/aaronilyas/BridgeToGrowth-Learning/releases/download/${PREVIEW_TAG}/${file}`;
    if (!page.links.includes(href)) throw new Error(`release preview missing ${href}`);
  }
}

function assertPartialPreview(page: PageState): void {
  assertCommon(page, "partial preview");
  if (page.links.length !== 1 || page.disabled !== 3) throw new Error(`partial preview had ${page.links.length} links`);
  if (!page.links[0]?.endsWith("BridgeToGrowthLearning-Setup-x64.exe")) throw new Error(`partial preview linked ${page.links[0] ?? "nothing"}`);
  if (!page.preview.includes("not a published version")) throw new Error(page.preview);
}

async function main(): Promise<void> {
  const screenshotDir = process.argv[2];
  if (screenshotDir) await mkdir(screenshotDir, { recursive: true });
  const userDataDir = await mkdtemp(join(tmpdir(), "btg-chrome-"));
  const site = await serve();
  const chrome = await launchChrome(userDataDir);
  try {
    const port = await waitForPort(userDataDir);
    const version = await fetch(`http://127.0.0.1:${port}/json/version`).then((response) => response.json()) as { webSocketDebuggerUrl?: string };
    if (!version.webSocketDebuggerUrl) throw new Error("Chrome did not provide a browser debugging socket");
    const browser = await connect(version.webSocketDebuggerUrl);
    const cases: Array<{ name: string; path: string; width: number; mobile: boolean; check: (page: PageState) => void; shot: string | null }> = [
      { name: "live", path: "/", width: 1280, mobile: false, check: assertLive, shot: "download_page_no_release.png" },
      { name: "mobile", path: "/", width: 390, mobile: true, check: assertLive, shot: "download_page_mobile.png" },
      { name: "empty", path: "/?preview=empty", width: 1280, mobile: false, check: assertEmptyPreview, shot: null },
      { name: "error", path: "/?preview=error", width: 1280, mobile: false, check: assertErrorPreview, shot: "download_page_api_failure.png" },
      { name: "release", path: "/?preview=release", width: 1280, mobile: false, check: assertReleasePreview, shot: "download_page_release_preview.png" },
      { name: "partial", path: "/?preview=partial", width: 1280, mobile: false, check: assertPartialPreview, shot: null },
    ];
    for (const item of cases) {
      const opened = await openPage(browser, port, `http://127.0.0.1:${site.port}${item.path}`, item.width, item.mobile);
      try {
        item.check(opened.state);
        if (screenshotDir && item.shot) await screenshot(opened.page, join(screenshotDir, item.shot), item.width);
        console.log(`ok ${item.name}: ${opened.state.state}`);
      } finally {
        await browser.send("Target.closeTarget", { targetId: opened.targetId }).catch(() => undefined);
        opened.page.close();
      }
    }
    browser.close();
  } finally {
    chrome.kill("SIGKILL");
    await site.close();
    await rm(userDataDir, { recursive: true, force: true });
  }
}

await main();
