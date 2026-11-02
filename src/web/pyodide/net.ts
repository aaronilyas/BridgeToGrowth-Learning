const DENY = "network access is disabled";

type ScriptHost = typeof globalThis & { importScripts?: (...urls: string[]) => void };

// O(1)
function denied(): never {
  throw new Error(DENY);
}

// O(1)
function blockedCtor(): new () => never {
  function Blocked(this: unknown): never {
    denied();
  }
  return Blocked as unknown as new () => never;
}

let savedFetch: typeof fetch | null = null;

// O(1)
function rememberFetch(): typeof fetch {
  savedFetch ??= globalThis.fetch.bind(globalThis);
  return savedFetch;
}

// O(1)
// SEC: during bootstrap, fetches may only read the same-origin Pyodide directory. Everything else is refused before user code runs.
export function allowAssetFetch(prefix: string): void {
  const real = rememberFetch();
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith(prefix)) denied();
    return real(input, init);
  }) as typeof fetch;
  blockSockets();
}

// O(1)
function blockSockets(): void {
  const host = globalThis as ScriptHost;
  host.XMLHttpRequest = blockedCtor() as unknown as typeof XMLHttpRequest;
  host.WebSocket = blockedCtor() as unknown as typeof WebSocket;
  host.EventSource = blockedCtor() as unknown as typeof EventSource;
  host.importScripts = () => denied();
  const nav = host.navigator;
  if (nav && "sendBeacon" in nav) nav.sendBeacon = (() => denied()) as typeof nav.sendBeacon;
}

// O(1)
// SEC: called after Pyodide and its allowlisted wheels have loaded. User code, including js.fetch and pyodide.http, has no network.
export function blockAllNetwork(): void {
  rememberFetch();
  globalThis.fetch = (() => denied()) as unknown as typeof fetch;
  blockSockets();
}
