import { normalizeLesson } from '../src/contracts';
import { Lessons } from '../src/lessons';
import { PENDING_KEY } from '../src/session';
import { OrderedStorage } from '../src/storage';
import { account, deferred, harness, job, response, tokens } from './fixtures';
async function fixture() { const h = harness(); await h.session.install(tokens(), h.session.version); let sequence = 0; const lessons = new Lessons(h.session, new OrderedStorage(h.storage), () => `key-${++sequence}`); return { ...h, lessons }; }
it('retains account-scoped key before sending, sends only the supported normalized payload', async () => {
  const h = await fixture();
  h.fetcher.mockImplementation(async () => { expect(JSON.parse(h.data.get(PENDING_KEY)!)).toMatchObject({ accountId: account.id, records: [{ key: 'key-1' }] }); return response(job()); });
  await h.lessons.submit(normalizeLesson('  moon phases  ', false));
  expect(JSON.parse(h.fetcher.mock.calls[0]?.[1]?.body as string)).toEqual({ topic: 'moon phases', voiceover: false });
  expect((h.fetcher.mock.calls[0]?.[1]?.headers as Record<string, string>)['Idempotency-Key']).toBe('key-1');
  expect(h.data.get(PENDING_KEY)).not.toContain('moon phases'); expect(h.lessons.records[0]?.jobId).toBe(job().id);
});
it('prevents duplicate taps even during initial storage load', async () => {
  const h = await fixture(), pending = deferred<Response>(); h.fetcher.mockReturnValueOnce(pending.promise);
  const first = h.lessons.submit({ topic: 'a topic', voiceover: false });
  await expect(h.lessons.submit({ topic: 'a topic', voiceover: false })).rejects.toThrow('already');
  pending.resolve(response(job())); await first; expect(h.fetcher).toHaveBeenCalledTimes(1); expect(h.lessons.records).toHaveLength(1);
});
it('never retries automatically after a lost response, explicit retries keep both key and payload unchanged', async () => {
  const h = await fixture(); h.fetcher.mockRejectedValueOnce(new Error('lost')).mockResolvedValueOnce(response(job()));
  await expect(h.lessons.submit({ topic: 'moon phases', voiceover: false })).rejects.toThrow();
  expect(h.fetcher).toHaveBeenCalledTimes(1);
  await h.lessons.submit({ topic: 'different', voiceover: true }, true);
  expect(h.fetcher.mock.calls[0]?.[1]?.body).toBe(h.fetcher.mock.calls[1]?.[1]?.body);
  expect(h.fetcher.mock.calls[0]?.[1]?.headers).toEqual(h.fetcher.mock.calls[1]?.[1]?.headers);
});
it('edited requests get new keys and leave unresolved keys retained', async () => {
  const h = await fixture(); h.fetcher.mockRejectedValueOnce(new Error('lost')).mockResolvedValueOnce(response(job()));
  await expect(h.lessons.submit({ topic: 'moon', voiceover: false })).rejects.toThrow(); h.lessons.edit();
  await h.lessons.submit({ topic: 'gravity', voiceover: false });
  expect(h.lessons.records.map(record => record.key)).toEqual(['key-1', 'key-2']);
});
it('does not submit if secure pending storage fails and does not queue offline replay', async () => {
  const h = await fixture(); (h.storage.set as jest.Mock).mockRejectedValueOnce(new Error('full'));
  await expect(h.lessons.submit({ topic: 'moon', voiceover: false })).rejects.toThrow(); expect(h.fetcher).not.toHaveBeenCalled();
  h.http.online = false; await expect(h.lessons.submit({ topic: 'moon', voiceover: false })).rejects.toThrow('Reconnect');
  h.http.online = true; expect(h.fetcher).not.toHaveBeenCalled();
});
it('retains IDs after restart but cannot reconstruct payloads or assume unknown keys are safe', async () => {
  const h = await fixture(); h.fetcher.mockResolvedValueOnce(response(job())).mockRejectedValueOnce(new Error('lost'));
  await h.lessons.submit({ topic: 'moon', voiceover: false }); h.lessons.edit();
  await expect(h.lessons.submit({ topic: 'gravity', voiceover: false })).rejects.toThrow();
  const restarted = new Lessons(h.session, new OrderedStorage(h.storage)); await restarted.load();
  expect(restarted.records).toHaveLength(2); expect(restarted.records[0]?.jobId).toBe(job().id); expect(restarted.attempt).toBeNull();
  await expect(restarted.submit({ topic: 'gravity', voiceover: false }, true)).rejects.toThrow('after restart'); expect(h.fetcher).toHaveBeenCalledTimes(2);
});
it('rejects stale submission responses and does not attach another account’s retained keys', async () => {
  const h = await fixture(), pending = deferred<Response>(); h.fetcher.mockReturnValueOnce(pending.promise);
  const submit = h.lessons.submit({ topic: 'moon', voiceover: false }); await new Promise(resolve => setTimeout(resolve, 0));
  await h.session.end(); h.lessons.clear();
  await h.session.install(tokens({ account: { ...account, id: 'other-account' } }), h.session.version);
  pending.resolve(response(job())); await expect(submit).rejects.toThrow('ended');
  await h.lessons.load(); expect(h.lessons.records).toEqual([]); expect(h.data.has(PENDING_KEY)).toBe(false);
});
it('bounds retained records and never evicts unresolved keys automatically', async () => {
  const h = await fixture(); h.fetcher.mockResolvedValue(response(job()));
  for (let i = 0; i < 6; i++) { h.lessons.edit(); await h.lessons.submit({ topic: `topic ${i}`, voiceover: false }); }
  await expect(h.lessons.submit({ topic: 'seventh', voiceover: false })).rejects.toThrow('Six requests'); expect(h.fetcher).toHaveBeenCalledTimes(6);
  await h.lessons.forget('key-1'); await h.lessons.submit({ topic: 'seventh', voiceover: false }); expect(h.lessons.records).toHaveLength(6);
});
it('does not silently discard corrupt pending metadata or infer that old requests are safe', async () => {
  const h = await fixture(); h.data.set(PENDING_KEY, JSON.stringify({ accountId: account.id, records: [{ key: 'unsafe key', createdAt: 1 }] }));
  await expect(h.lessons.load()).rejects.toThrow('unreadable');
  await expect(h.lessons.submit({ topic: 'moon', voiceover: false })).rejects.toThrow('unreadable'); expect(h.fetcher).not.toHaveBeenCalled();
});
it('retains the key and allows only explicit retry after a malformed success response', async () => {
  const h = await fixture(); h.fetcher.mockResolvedValueOnce(response({ accepted: true })).mockResolvedValueOnce(response(job()));
  await expect(h.lessons.submit({ topic: 'moon', voiceover: false })).rejects.toThrow('could not be confirmed');
  expect(h.lessons.records[0]?.jobId).toBeUndefined();
  await h.lessons.submit({ topic: 'edited', voiceover: true }, true);
  expect(h.fetcher.mock.calls[0]?.[1]?.body).toEqual(h.fetcher.mock.calls[1]?.[1]?.body);
});
