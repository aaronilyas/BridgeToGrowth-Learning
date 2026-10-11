import { Account, Tokens } from './contracts';
import { ApiError, Http, OfflineError, StaleError } from './http';
import { Storage } from './storage';
export const SESSION_KEY = 'btg.session.v1';
export const PENDING_KEY = 'btg.pending.v1';
interface RefreshCredential { accountId: string; refreshToken: string; expiresAt: number }
export interface SessionState { phase: 'restoring' | 'signedOut' | 'signedIn' | 'restoreError'; account: Account | null; message: string }
const signedOut = (message = ''): SessionState => ({ phase: 'signedOut', account: null, message });
export class Session {
  private credential: RefreshCredential | null = null;
  private access: { token: string; expiresAt: number } | null = null;
  private rotation: Promise<void> | null = null;
  private restoration: Promise<void> | null = null;
  private controllers = new Set<AbortController>();
  private listeners = new Set<() => void>();
  private epoch = 0;
  private cleanup: Promise<void> = Promise.resolve();
  private storageUnsafe = false;
  state: SessionState = { phase: 'restoring', account: null, message: '' };
  constructor(readonly http: Http, private storage: Storage, private clearCaches: () => void, private now = Date.now) {}
  subscribe = (callback: () => void) => { this.listeners.add(callback); return () => { this.listeners.delete(callback); }; };
  snapshot = () => this.state;
  get version() { return this.epoch; }
  assert(version: number) { if (version !== this.epoch) throw new StaleError(); }
  private publish(state: SessionState) { this.state = state; this.listeners.forEach(callback => callback()); }
  private invalidate() {
    this.epoch++; this.controllers.forEach(controller => controller.abort()); this.controllers.clear();
    this.access = null; this.credential = null; this.rotation = null; this.clearCaches();
  }
  async end(message = 'Your session ended. Please log in again.'): Promise<void> {
    this.invalidate(); this.publish(signedOut(message));
    const version = this.epoch;
    const clear = async () => {
      // A tombstone prevents restoring a possibly consumed token if deletion fails.
      let marked = false;
      try { await this.storage.set(SESSION_KEY, JSON.stringify({ blocked: true })); marked = true; } catch { /* Try deletion independently. */ }
      let removed = false;
      try { await this.storage.remove(SESSION_KEY); removed = true; } catch { /* Tombstone is retained. */ }
      try { await this.storage.remove(PENDING_KEY); } catch { /* Records are account-scoped and cannot authorize requests. */ }
      if (!marked && !removed) {
        this.storageUnsafe = true;
        if (version === this.epoch) this.publish(signedOut('Secure storage could not be cleared. Close the app and clear its storage before using another account.'));
      }
    };
    this.cleanup = this.cleanup.then(clear, clear);
    await this.cleanup;
  }
  private validate(tokens: Tokens) {
    if (tokens.token_type !== 'Bearer' || typeof tokens.access_token !== 'string' || tokens.access_token.length < 20 || typeof tokens.refresh_token !== 'string' || tokens.refresh_token.length < 20 || !Number.isFinite(tokens.expires_in) || tokens.expires_in <= 0 || !Number.isFinite(tokens.refresh_expires_in) || tokens.refresh_expires_in <= 0) throw new Error('Invalid session response. Please log in again.');
  }
  async install(tokens: Tokens, version: number, requestStartedAt = this.now()) {
    await this.cleanup;
    if (this.storageUnsafe) throw new Error('Secure storage is unsafe. Clear app storage before logging in.');
    this.assert(version); this.validate(tokens);
    if (!tokens.account?.id || !tokens.account.phone_verified) throw new Error('A verified account is required.');
    this.invalidate(); const current = this.epoch;
    this.publish({ phase: 'restoring', account: null, message: '' });
    const credential = { accountId: tokens.account.id, refreshToken: tokens.refresh_token, expiresAt: requestStartedAt + tokens.refresh_expires_in * 1000 };
    try {
      await this.storage.remove(PENDING_KEY); this.assert(current);
      await this.storage.set(SESSION_KEY, JSON.stringify(credential)); this.assert(current);
      this.credential = credential;
      this.access = { token: tokens.access_token, expiresAt: requestStartedAt + tokens.expires_in * 1000 };
      this.publish({ phase: 'signedIn', account: tokens.account, message: '' });
    } catch (error) {
      if (current === this.epoch) await this.end('Session could not be saved safely. Please log in again.');
      throw error;
    }
  }
  async restore() {
    if (this.restoration) return this.restoration;
    const restoration = this.restoreOnce(); this.restoration = restoration;
    try { await restoration; } finally { if (this.restoration === restoration) this.restoration = null; }
  }
  private async restoreOnce() {
    await this.cleanup;
    if (this.storageUnsafe) return;
    const version = this.epoch;
    this.publish({ phase: 'restoring', account: null, message: '' });
    try {
      const raw = await this.storage.get(SESSION_KEY); this.assert(version);
      if (!raw) { this.publish(signedOut()); return; }
      const value: Partial<RefreshCredential> = JSON.parse(raw);
      if (!value.accountId || typeof value.refreshToken !== 'string' || value.refreshToken.length < 20 || !Number.isFinite(value.expiresAt) || value.expiresAt! <= this.now()) { await this.end(); return; }
      this.credential = value as RefreshCredential;
      await this.refresh(); this.assert(version);
      const account = await this.request<Account>('/account'); this.assert(version);
      if (account.id !== this.credential?.accountId || !account.phone_verified) {
        await this.end('The restored account could not be verified safely. Please log in again.'); return;
      }
      this.publish({ phase: 'signedIn', account, message: '' });
    } catch (error) {
      if (version !== this.epoch) return;
      if (error instanceof ApiError && error.status === 429) this.publish({ phase: 'restoreError', account: null, message: 'Session restoration is throttled. Wait until the retry period ends, then retry manually.' });
      else if (error instanceof OfflineError) this.publish({ phase: 'restoreError', account: null, message: 'Reconnect to restore your session.' });
      else if (this.access) this.publish({ phase: 'restoreError', account: null, message: 'Could not check your account. Retry when connected.' });
      else await this.end('Session restoration failed. Please log in again.');
    }
  }
  async refresh(): Promise<void> {
    if (this.rotation) return this.rotation;
    if (!this.http.online) throw new OfflineError();
    const version = this.epoch, credential = this.credential;
    if (!credential || credential.expiresAt <= this.now()) {
      if (this.state.phase !== 'signedOut') await this.end();
      throw new StaleError();
    }
    const rotate = async () => {
      let throttled = false;
      try {
        // Invalidate the persisted token BEFORE it can be consumed by the server.
        await this.storage.set(SESSION_KEY, JSON.stringify({ blocked: true })); this.assert(version);
        const requestStartedAt = this.now();
        let tokens: Tokens;
        try { tokens = await this.http.request<Tokens>('/auth/refresh', { refresh_token: credential.refreshToken }); }
        catch (error) {
          // This backend throttles before token lookup/consumption. Only a
          // definite 429 can restore the unused credential; never a timeout.
          if (error instanceof ApiError && error.status === 429) {
            this.assert(version);
            await this.storage.set(SESSION_KEY, JSON.stringify(credential)); this.assert(version);
            throttled = true;
          }
          throw error;
        }
        this.assert(version);
        this.validate(tokens);
        const next: RefreshCredential = { ...credential, refreshToken: tokens.refresh_token, expiresAt: Math.min(credential.expiresAt, requestStartedAt + tokens.refresh_expires_in * 1000) };
        await this.storage.set(SESSION_KEY, JSON.stringify(next)); this.assert(version);
        this.credential = next;
        this.access = { token: tokens.access_token, expiresAt: requestStartedAt + tokens.expires_in * 1000 };
      } catch (error) {
        if (version === this.epoch && !throttled) await this.end('Session renewal could not be confirmed safely. Please log in again.');
        throw error;
      }
    };
    const rotation = rotate(); this.rotation = rotation;
    try { await rotation; } finally { if (this.rotation === rotation) this.rotation = null; }
  }
  async request<T>(path: string, body?: unknown, extra?: Record<string, string>, signal?: AbortSignal): Promise<T> {
    const version = this.epoch;
    if (this.rotation) await this.rotation;
    this.assert(version);
    if (!this.access || this.access.expiresAt <= this.now() + 10000) await this.refresh();
    this.assert(version);
    const token = this.access!.token, controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort);
    if (signal?.aborted) abort();
    this.controllers.add(controller);
    try {
      const result = await this.http.request<T>(path, body, token, controller.signal, extra); this.assert(version); return result;
    } catch (error) {
      this.assert(version);
      // An already in-flight read can see the previous token during rotation.
      if (error instanceof ApiError && error.status === 401) {
        if (this.rotation || token !== this.access?.token) {
          await this.rotation; this.assert(version);
          if (body === undefined) return this.request<T>(path, body, extra, signal);
          // The old bearer was invalidated by our rotation. Preserve the new
          // session, but the mutation still requires a deliberate manual retry.
          throw new Error('Your session renewed while this request was in progress. Retry the same request manually.');
        }
        // Phone reauthentication uses 401 for a wrong current password too.
        if (path !== '/account/phone') await this.end();
      }
      throw error;
    } finally { this.controllers.delete(controller); signal?.removeEventListener('abort', abort); }
  }
  async logout(all = false): Promise<boolean> {
    let revoked = false;
    try { await this.request(all ? '/auth/logout-all' : '/auth/logout', {}); revoked = true; }
    catch { /* Always clear locally, regardless of network outcome. */ }
    await this.end(revoked ? (all ? 'All sessions were revoked.' : 'Session revoked. You are logged out.') : 'Logged out on this device. Server revocation was not confirmed; other sessions may remain active.');
    return revoked;
  }
}
