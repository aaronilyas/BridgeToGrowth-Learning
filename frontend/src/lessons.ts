import * as Crypto from 'expo-crypto';
import { LessonPayload } from './contracts';
import { Job } from './job-policy';
import { Session, PENDING_KEY } from './session';
import { Storage } from './storage';
export interface PendingRecord { key: string; createdAt: number; jobId?: string }
export interface Attempt { key: string; payload: Readonly<LessonPayload>; job?: Job }
export class Lessons {
  records: PendingRecord[] = [];
  attempt: Attempt | null = null;
  private busy = false;
  private accountId = '';
  private loading: Promise<void> | null = null;
  private listeners = new Set<() => void>();
  private revision = 0;
  subscribe = (callback: () => void) => { this.listeners.add(callback); return () => { this.listeners.delete(callback); }; };
  snapshot = () => this.revision;
  private changed() { this.revision++; this.listeners.forEach(callback => callback()); }
  constructor(private session: Session, private storage: Storage, private uuid = Crypto.randomUUID, private now = Date.now) {}
  clear() { this.records = []; this.attempt = null; this.accountId = ''; this.loading = null; this.busy = false; this.changed(); }
  async load() {
    if (this.loading) return this.loading;
    const version = this.session.version, accountId = this.session.state.account?.id;
    if (!accountId) return;
    if (this.accountId === accountId) return;
    const read = async () => {
      const raw = await this.storage.get(PENDING_KEY); this.session.assert(version);
      if (raw) {
        const saved = JSON.parse(raw) as { accountId?: string; records?: PendingRecord[] };
        if (saved.accountId === accountId) {
          if (!Array.isArray(saved.records) || saved.records.length > 6 || saved.records.some(record => !record || typeof record.key !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(record.key) || !Number.isFinite(record.createdAt) || (record.jobId && !/^[a-f0-9-]{36}$/i.test(record.jobId)))) throw new Error('Retained request metadata is unreadable. Do not assume earlier requests failed. Clear app storage only after reviewing that risk.');
          this.records = saved.records;
        }
      }
      this.accountId = accountId;
      this.changed();
    };
    const loading = read(); this.loading = loading;
    try { await loading; } finally { if (this.loading === loading) this.loading = null; }
  }
  edit() { this.attempt = null; this.changed(); }
  private async save(version: number) {
    this.session.assert(version);
    await this.storage.set(PENDING_KEY, JSON.stringify({ accountId: this.accountId, records: this.records }));
    this.session.assert(version);
  }
  async submit(payload: LessonPayload, retry = false): Promise<Job> {
    if (this.busy) throw new Error('A lesson request is already in progress.');
    const accountId = this.session.state.account?.id, version = this.session.version;
    if (!accountId) throw new Error('Log in before requesting a lesson.');
    if (!this.session.http.online) throw new Error('Reconnect and submit manually.');
    if (this.accountId !== accountId) await this.load();
    this.session.assert(version);
    if (this.busy) throw new Error('A lesson request is already in progress.');
    this.busy = true;
    const attempt = retry ? this.attempt : { key: this.uuid(), payload: Object.freeze({ ...payload }) };
    try {
      if (!attempt) throw new Error('This request cannot be retried after restart. The original topic was not retained.');
      if (!retry) {
        // Never discard an unresolved key to make room for another send.
        if (this.records.length >= 6) throw new Error('Six requests are retained. Review them and remove a resolved record before requesting another lesson.');
        this.attempt = attempt;
        this.records = [...this.records, { key: attempt.key, createdAt: this.now() }];
      }
      await this.save(version); // Failure here MUST prevent network submission.
      const job = await this.session.request<Job>('/lessons', attempt.payload, { 'Idempotency-Key': attempt.key });
      if (!job || typeof job.id !== 'string' || !/^[a-f0-9-]{36}$/i.test(job.id) || typeof job.status !== 'string') throw new Error('The lesson response could not be confirmed. Retry the same retained request manually.');
      this.session.assert(version); attempt.job = job;
      this.records = this.records.map(record => record.key === attempt.key ? { ...record, jobId: job.id } : record);
      // If this save fails the in-memory ID is still useful, but no new request is made.
      await this.save(version); return job;
    } finally { if (version === this.session.version) { this.busy = false; this.changed(); } }
  }
  async forget(key: string) {
    if (this.busy) throw new Error('Wait for the current request.');
    const version = this.session.version;
    this.records = this.records.filter(record => record.key !== key);
    if (this.attempt?.key === key) this.attempt = null;
    await this.save(version); this.changed();
  }
}
