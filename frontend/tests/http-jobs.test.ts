import { codeValid, normalizeLesson, passwordValid, phoneValid } from '../src/contracts';
import { ApiError, retryAfter } from '../src/http';
import { cancelAndReconcile } from '../src/jobs';
import { harness, job, response, tokens } from './fixtures';
it('uses exact backend validation, including Unicode character lengths and leading zeroes', () => {
  expect(codeValid('012345')).toBe(true); expect(codeValid('12345')).toBe(false); expect(codeValid(' 012345')).toBe(false);
  expect(passwordValid(' '.repeat(12))).toBe(true); expect(passwordValid('😀'.repeat(11))).toBe(false);
  expect(phoneValid('+12345678')).toBe(true); expect(phoneValid('+012345678')).toBe(false);
  expect(normalizeLesson(' \nmoon \t', false)).toEqual({ topic: 'moon', voiceover: false });
  expect(() => normalizeLesson(' '.repeat(12), false)).toThrow(); expect(() => normalizeLesson('x'.repeat(10001), true)).toThrow();
});
it('honors numeric and HTTP-date Retry-After and never discloses error bodies', async () => {
  const h = harness(); h.fetcher.mockResolvedValueOnce(response({ detail: 'provider secret' }, 429, { 'Retry-After': '60' }));
  await expect(h.http.request('/auth/login', {})).rejects.toMatchObject({ status: 429, retryAt: 1060000 });
  await expect(h.http.request('/auth/login', {})).rejects.toBeInstanceOf(ApiError); expect(h.fetcher).toHaveBeenCalledTimes(1);
  expect(retryAfter('Thu, 01 Jan 1970 00:01:00 GMT', 0)).toBe(60000);
  h.tick(60001); h.fetcher.mockResolvedValueOnce(response({})); await h.http.request('/auth/login', {}); expect(h.fetcher).toHaveBeenCalledTimes(2);
});
it('reconciles cancellation acknowledgement without calling the job cancelled prematurely', async () => {
  const h = harness(); await h.session.install(tokens(), h.session.version);
  h.fetcher.mockResolvedValueOnce(response(job({ cancel_requested: true }), 202)).mockResolvedValueOnce(response(job({ status: 'rendering', cancel_requested: true, cleanup_pending: true })));
  expect(await cancelAndReconcile(h.session, job().id)).toMatchObject({ status: 'rendering', cleanup_pending: true }); expect(h.fetcher).toHaveBeenCalledTimes(2);
});
it('refetches after the messaging cutoff conflict and preserves the accepted outcome', async () => {
  const h = harness(); await h.session.install(tokens(), h.session.version);
  h.fetcher.mockResolvedValueOnce(response({}, 409)).mockResolvedValueOnce(response(job({ status: 'accepted', photon_accepted: true, provider_message_id: 'message' })));
  expect(await cancelAndReconcile(h.session, job().id)).toMatchObject({ status: 'accepted' }); expect(h.fetcher).toHaveBeenCalledTimes(2);
});
it('refetches a lost cancellation response and does not retry the cancellation automatically', async () => {
  const h = harness(); await h.session.install(tokens(), h.session.version);
  h.fetcher.mockRejectedValueOnce(new Error('lost')).mockResolvedValueOnce(response(job({ status: 'cancelled' })));
  await expect(cancelAndReconcile(h.session, job().id)).rejects.toThrow();
  expect(h.fetcher.mock.calls.filter(call => call[0].endsWith('/cancel'))).toHaveLength(1);
});
