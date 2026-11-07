import { applyPage, describePage, loadLatest, matchingIds, requestForLocation } from "./releases.js";

const request = requestForLocation(new URL(location.href));
const root = document.documentElement;

applyPage(document, describePage({ kind: "loading", preview: request.preview, release: null }, []));
root.dataset.releaseState = "loading";

const userAgent = navigator.userAgent;
const platform = navigator.userAgentData?.platform || navigator.platform || "";

async function detectArchitecture() {
  const hints = navigator.userAgentData;
  if (!hints || typeof hints.getHighEntropyValues !== "function") return null;
  try {
    const values = await hints.getHighEntropyValues(["architecture"]);
    return typeof values.architecture === "string" ? values.architecture : null;
  } catch {
    return null;
  }
}

try {
  const [view, architecture] = await Promise.all([
    loadLatest(fetch.bind(globalThis), request),
    detectArchitecture(),
  ]);
  applyPage(document, describePage(view, matchingIds(userAgent, platform, architecture)));
  root.dataset.releaseState = view.kind;
} catch {
  applyPage(document, describePage({ kind: "error", preview: request.preview, release: null }, []));
  root.dataset.releaseState = "error";
}
