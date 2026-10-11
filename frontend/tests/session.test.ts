import { ApiError, OfflineError, StaleError } from '../src/http';
import { SESSION_KEY, Session } from '../src/session';
import { OrderedStorage } from '../src/storage';
import { account, deferred, harness, response, tokens } from './fixtures';
it('saves only refresh credentials and restores before exposing the account', async () => {
  const h = harness(); await h.session.install(tokens(), h.session.version);
  const saved = JSON.parse(h.data.get(SESSION_KEY)!);
  expect(saved).toEqual({ accountId: account.id, refreshToken: tokens().refresh_token, expiresAt: 2593000000 });
  expect(h.data.get(SESSION_KEY)).not.toContain(tokens().access_token);
  const restored = new Session(h.http, new OrderedStorage(h.storage), h.clear, () => 1000000);
  const pending = deferred<Response>(); h.fetcher.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(response(account));
  const restore = restored.restore(); await Promise.resolve();
  expect(restored.state.phase).toBe('restoring'); expect(restored.state.account).toBeNull();
  pending.resolve(response(tokens({ account: undefined }))); await restore;
  expect(restored.state).toMatchObject({ phase: 'signedIn', account });
});
it('serializes concurrent expiry refreshes and holds requests until secure save finishes', async () => {
  const h = harness(); await h.session.install(tokens(), h.session.version); h.tick(901000);
  const rotated = tokens({ account: undefined, access_token: 'new-access-'.repeat(4), refresh_token: 'new-refresh-'.repeat(4) });
  const gate = deferred<void>(), set = h.storage.set as jest.Mock;
  set.mockImplementation(async (key: string, value: string) => { if (value.includes(rotated.refresh_token)) await gate.promise; h.data.set(key, value); });
  h.fetcher.mockResolvedValueOnce(response(rotated)).mockResolvedValue(response(account));
  const first = h.session.request('/account'), second = h.session.request('/account');
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(h.fetcher).toHaveBeenCalledTimes(1); expect(JSON.parse(h.data.get(SESSION_KEY)!)).toEqual({ blocked: true });
  gate.resolve(); await Promise.all([first, second]);
  expect(h.fetcher).toHaveBeenCalledTimes(3);
  expect(h.fetcher.mock.calls.slice(1).every(call => (call[1]?.headers as Record<string, string>).Authorization === `Bearer ${rotated.access_token}`)).toBe(true);
});
it('does not extend absolute refresh expiry even if the server reports a longer duration', async () => {
  const h = harness(); await h.session.install(tokens({ refresh_expires_in: 1000 }), h.session.version);
  h.tick(901000); h.fetcher.mockResolvedValueOnce(response(tokens({ refresh_expires_in: 999999 }))).mockResolvedValueOnce(response(account));
  await h.session.request('/account'); expect(JSON.parse(h.data.get(SESSION_KEY)!).expiresAt).toBe(2000000);
  h.tick(100000); await expect(h.session.refresh()).rejects.toBeInstanceOf(StaleError);
  expect(h.session.state.phase).toBe('signedOut');
});
it('requires reauthentication after a lost refresh response and never reuses the old token', async () => {
  const h = harness(); await h.session.install(tokens(), h.session.version); h.tick(901000);
  h.fetcher.mockRejectedValueOnce(new Error('network lost'));
  await expect(h.session.request('/account')).rejects.toThrow();
  expect(h.session.state.phase).toBe('signedOut'); expect(h.data.has(SESSION_KEY)).toBe(false);
  await expect(h.session.request('/account')).rejects.toThrow(); expect(h.fetcher).toHaveBeenCalledTimes(1);
});
it('tombstones before refresh so a process restart cannot reuse a consumed credential', async () => {
  const h = harness(); await h.session.install(tokens(), h.session.version);
  const gate = deferred<Response>(); h.fetcher.mockReturnValueOnce(gate.promise);
  const rotation = h.session.refresh(); await new Promise(resolve => setTimeout(resolve, 0));
  expect(JSON.parse(h.data.get(SESSION_KEY)!)).toEqual({ blocked: true });
  const restarted = new Session(h.http, new OrderedStorage(h.storage), h.clear);
  await restarted.restore(); expect(restarted.state.phase).toBe('signedOut'); expect(h.fetcher).toHaveBeenCalledTimes(1);
  gate.reject(new Error('lost')); await expect(rotation).rejects.toThrow();
});
it('prevents rotation if the consumed-token marker cannot be stored', async () => {
  const h = harness(); await h.session.install(tokens(), h.session.version);
  (h.storage.set as jest.Mock).mockRejectedValue(new Error('storage unavailable'));
  await expect(h.session.refresh()).rejects.toThrow(); expect(h.fetcher).not.toHaveBeenCalled(); expect(h.session.state.phase).toBe('signedOut');
});
it('discards rotated tokens on secure save failure, retaining a tombstone when deletion fails', async () => {
  const h = harness(); await h.session.install(tokens(), h.session.version);
  const rotated = tokens({ refresh_token: 'rotated-secret-'.repeat(4) });
  (h.storage.set as jest.Mock).mockImplementation(async (key, value) => { if (value.includes(rotated.refresh_token)) throw new Error('full'); h.data.set(key, value); });
  (h.storage.remove as jest.Mock).mockRejectedValue(new Error('deletion failed'));
  h.fetcher.mockResolvedValueOnce(response(rotated)); await expect(h.session.refresh()).rejects.toThrow();
  expect(h.session.state.phase).toBe('signedOut'); expect(JSON.parse(h.data.get(SESSION_KEY)!)).toEqual({ blocked: true });
});
it('rejects stale account responses after logout and account switching and clears caches', async () => {
  const h = harness(); await h.session.install(tokens(), h.session.version);
  const old = deferred<Response>(); h.fetcher.mockReturnValueOnce(old.promise);
  const read = h.session.request('/account');
  await h.session.end();
  const other = { ...account, id: '33333333-3333-4333-8333-333333333333', phone_number: '+15557654321' };
  await h.session.install(tokens({ account: other }), h.session.version);
  old.resolve(response(account)); await expect(read).rejects.toBeInstanceOf(StaleError);
  expect(h.session.state.account).toEqual(other); expect(h.clear).toHaveBeenCalledTimes(3);
});
it('ignores a late refresh response after logout without overwriting the next account', async () => {
  const h = harness(); await h.session.install(tokens(), h.session.version);
  const pending = deferred<Response>(); h.fetcher.mockReturnValueOnce(pending.promise);
  const rotation = h.session.refresh(); await new Promise(resolve => setTimeout(resolve, 0));
  await h.session.end(); await h.session.install(tokens({ refresh_token: 'another-account-'.repeat(3) }), h.session.version);
  pending.resolve(response(tokens())); await expect(rotation).rejects.toBeInstanceOf(StaleError);
  expect(JSON.parse(h.data.get(SESSION_KEY)!).refreshToken).toBe('another-account-'.repeat(3));
});
it('keeps offline restoration gated without consuming refresh credentials', async () => {
  const h = harness(); await h.session.install(tokens(), h.session.version); h.http.online = false;
  const restored = new Session(h.http, new OrderedStorage(h.storage), h.clear, () => 1000000);
  await restored.restore(); expect(restored.state.phase).toBe('restoreError'); expect(restored.state.account).toBeNull(); expect(h.fetcher).not.toHaveBeenCalled();
  await expect(h.session.refresh()).rejects.toBeInstanceOf(OfflineError);
});
it('attempts logout-all revocation and distinguishes local-only logout', async () => {
  const h = harness(); await h.session.install(tokens(), h.session.version); h.fetcher.mockResolvedValueOnce(response(null, 204));
  expect(await h.session.logout(true)).toBe(true); expect(h.fetcher.mock.calls[0]?.[0]).toContain('/auth/logout-all');
  await h.session.install(tokens(), h.session.version); h.http.online = false;
  expect(await h.session.logout()).toBe(false); expect(h.session.state.message).toContain('not confirmed'); expect(h.data.has(SESSION_KEY)).toBe(false);
});
it('does not replay a mutation that sees 401; revoked protected reads end the session', async () => {
  const h = harness(); await h.session.install(tokens(), h.session.version); h.fetcher.mockResolvedValue(response({}, 401));
  await expect(h.session.request('/lessons', { topic: 'gravity', voiceover: false })).rejects.toBeInstanceOf(ApiError);
  expect(h.fetcher).toHaveBeenCalledTimes(1); expect(h.session.state.phase).toBe('signedOut');
});
it('wrong current password in the phone flow is not evidence that the bearer was revoked', async () => {
  const h = harness(); await h.session.install(tokens(), h.session.version); h.fetcher.mockResolvedValue(response({}, 401));
  await expect(h.session.request('/account/phone', {})).rejects.toBeInstanceOf(ApiError); expect(h.session.state.phase).toBe('signedIn');
});
it('keeps the new session when an old in-flight mutation receives 401 during rotation, without replay', async () => {
  const h = harness(); await h.session.install(tokens(), h.session.version);
  const mutation = deferred<Response>(), rotation = deferred<Response>();
  h.fetcher.mockReturnValueOnce(mutation.promise).mockReturnValueOnce(rotation.promise);
  const submit = h.session.request('/lessons', { topic: 'moon', voiceover: false });
  const refresh = h.session.refresh(); await new Promise(resolve => setTimeout(resolve, 0));
  mutation.resolve(response({}, 401));
  rotation.resolve(response(tokens({ access_token: 'new-access-'.repeat(4), refresh_token: 'new-refresh-'.repeat(4) })));
  await refresh; await expect(submit).rejects.toThrow('Retry the same request manually');
  expect(h.fetcher).toHaveBeenCalledTimes(2); expect(h.session.state.phase).toBe('signedIn');
});
it('preserves unused refresh credentials after definite pre-consumption 429, waits for Retry-After', async () => {
  const h = harness(); await h.session.install(tokens(), h.session.version);
  const before = h.data.get(SESSION_KEY); h.fetcher.mockResolvedValueOnce(response({}, 429, { 'Retry-After': '60' })).mockResolvedValueOnce(response(tokens()));
  await expect(h.session.refresh()).rejects.toBeInstanceOf(ApiError); expect(h.data.get(SESSION_KEY)).toBe(before); expect(h.session.state.phase).toBe('signedIn');
  await expect(h.session.refresh()).rejects.toBeInstanceOf(ApiError); expect(h.fetcher).toHaveBeenCalledTimes(1);
  h.tick(60001); await h.session.refresh(); expect(h.fetcher).toHaveBeenCalledTimes(2);
});
it('blocks account replacement if neither credential tombstoning nor deletion is possible', async () => {
  const h = harness(); await h.session.install(tokens(), h.session.version);
  (h.storage.set as jest.Mock).mockRejectedValue(new Error('failed')); (h.storage.remove as jest.Mock).mockRejectedValue(new Error('failed'));
  await h.session.end(); expect(h.session.state.message).toContain('could not be cleared');
  await expect(h.session.install(tokens(), h.session.version)).rejects.toThrow('unsafe'); expect(h.session.state.phase).toBe('signedOut');
});
it('serializes duplicate restore taps even while the stored token is marked consumed', async () => {
  const h = harness(); await h.session.install(tokens(), h.session.version);
  const restored = new Session(h.http, new OrderedStorage(h.storage), h.clear, () => 1000000), pending = deferred<Response>();
  h.fetcher.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(response(account));
  const first = restored.restore(); await new Promise(resolve => setTimeout(resolve, 0));
  expect(JSON.parse(h.data.get(SESSION_KEY)!)).toEqual({ blocked: true });
  const second = restored.restore(); pending.resolve(response(tokens({ account: undefined })));
  await Promise.all([first, second]); expect(h.fetcher).toHaveBeenCalledTimes(2); expect(restored.state.phase).toBe('signedIn');
});
it('ends restoration instead of exposing or retaining a mismatched account credential', async () => {
  const h = harness(); await h.session.install(tokens(), h.session.version);
  const restored = new Session(h.http, new OrderedStorage(h.storage), h.clear, () => 1000000);
  h.fetcher.mockResolvedValueOnce(response(tokens({ account: undefined }))).mockResolvedValueOnce(response({ ...account, id: 'different-account' }));
  await restored.restore(); expect(restored.state.phase).toBe('signedOut'); expect(restored.state.account).toBeNull(); expect(h.data.has(SESSION_KEY)).toBe(false);
});
