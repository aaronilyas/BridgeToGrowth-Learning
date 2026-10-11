import { Account, Tokens } from '../src/contracts';
import { Http } from '../src/http';
import { Job } from '../src/job-policy';
import { Session } from '../src/session';
import { OrderedStorage, Storage } from '../src/storage';
export const account: Account = { id: '11111111-1111-4111-8111-111111111111', phone_number: '+15551234567', phone_verified: true };
export const tokens = (overrides: Partial<Tokens> = {}): Tokens => ({ token_type: 'Bearer', access_token: 'access-a-'.repeat(4), refresh_token: 'refresh-a-'.repeat(4), expires_in: 900, refresh_expires_in: 2592000, account, ...overrides });
export const job = (overrides: Partial<Job> = {}): Job => ({ id: '22222222-2222-4222-8222-222222222222', status: 'queued', estimated_duration_seconds: null, rendered_duration_seconds: null, feedback: null, failure_reason: null, evaluation: null, cancel_requested: false, cleanup_pending: false, photon_accepted: false, provider_message_id: null, receipt_status: 'unconfirmed', read_at: null, ...overrides });
export function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
export function response(body: unknown, status = 200, headers: Record<string, string> = {}): Response { return { ok: status >= 200 && status < 300, status, headers: { get: (key: string) => headers[key] ?? null }, json: async () => body } as Response; }
export function memoryStorage() {
  const data = new Map<string, string>();
  const storage: Storage = { get: jest.fn(async key => data.get(key) ?? null), set: jest.fn(async (key, value) => { data.set(key, value); }), remove: jest.fn(async key => { data.delete(key); }) };
  return { storage, data };
}
export function harness() {
  const memory = memoryStorage(), fetcher = jest.fn<Promise<Response>, [string, RequestInit?]>();
  let now = 1000000;
  const http = new Http('https://api.example.test', fetcher as typeof fetch, () => now);
  const clear = jest.fn(), session = new Session(http, new OrderedStorage(memory.storage), clear, () => now);
  return { ...memory, fetcher, http, session, clear, tick: (milliseconds: number) => { now += milliseconds; } };
}
