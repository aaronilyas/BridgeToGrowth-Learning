export class ApiError extends Error {
  constructor(public status: number, public retryAt = 0) {
    super(status === 429 ? 'Too many attempts. Wait before trying again.' : status === 401 ? 'Invalid or expired credentials. Please log in again.' : status === 400 ? 'Invalid or expired verification. Check the code or start again.' : status === 409 ? 'The request conflicts with the current server state. Refresh to check the outcome.' : status === 404 ? 'This lesson is unavailable for this account.' : status === 422 ? 'Check the fields and try again.' : 'The service is unavailable. Try again manually.');
  }
}
export class OfflineError extends Error { constructor() { super('You are offline. Reconnect and try again manually.'); } }
export class UncertainError extends Error { constructor() { super('The response could not be confirmed. Check the outcome before making a new request.'); } }
export class StaleError extends Error { constructor() { super('This account session has ended.'); } }
export function retryAfter(value: string | null, now: number): number {
  if (!value) return 0;
  const seconds = Number(value);
  const time = Number.isFinite(seconds) && seconds >= 0 ? now + seconds * 1000 : Date.parse(value);
  return Number.isFinite(time) ? Math.max(now, time) : 0;
}
export class Http {
  online = true;
  setOnline(value: boolean) { this.online = value; }
  blockedUntil = 0;
  constructor(readonly baseUrl: string, private fetcher: typeof fetch = fetch, private now = Date.now) {}
  async request<T>(path: string, body?: unknown, token?: string, signal?: AbortSignal, extra?: Record<string, string>): Promise<T> {
    if (!this.online) throw new OfflineError();
    if (this.blockedUntil > this.now()) throw new ApiError(429, this.blockedUntil);
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (signal?.aborted) controller.abort();
    signal?.addEventListener('abort', abort);
    const timeout = setTimeout(abort, 20000);
    try {
      const response = await this.fetcher(this.baseUrl + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra }, body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal, cache: 'no-store' });
      if (!response.ok) {
        const retryAt = retryAfter(response.headers.get('Retry-After'), this.now());
        if (response.status === 429) this.blockedUntil = Math.max(this.blockedUntil, retryAt || this.now() + 900000);
        throw new ApiError(response.status, this.blockedUntil);
      }
      if (response.status === 204) return undefined as T;
      return await response.json() as T;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new UncertainError();
    } finally { clearTimeout(timeout); signal?.removeEventListener('abort', abort); }
  }
}
export function apiBaseUrl(value: string | undefined): string {
  if (!value) throw new Error('Set EXPO_PUBLIC_API_BASE_URL to your HTTPS API origin.');
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('API configuration must be an origin without credentials or a path.');
  if (url.protocol !== 'https:' && !(typeof __DEV__ !== 'undefined' && __DEV__ && url.protocol === 'http:')) throw new Error('Use HTTPS for the API origin.');
  return url.origin;
}
