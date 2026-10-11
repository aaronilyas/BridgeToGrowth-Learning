import { canCancel, isTerminal, Job, jobMessage, pollDelay } from '../src/job-policy';

const makeJob = (overrides: Partial<Job> = {}): Job => ({
  id: 'job-1',
  status: 'queued',
  estimated_duration_seconds: null,
  rendered_duration_seconds: null,
  feedback: null,
  failure_reason: null,
  evaluation: null,
  cancel_requested: false,
  cleanup_pending: false,
  photon_accepted: false,
  provider_message_id: null,
  receipt_status: 'unconfirmed',
  read_at: null,
  ...overrides,
});

const pollOptions = (overrides: Partial<{
  online: boolean;
  active: boolean;
  errors: number;
  receiptChecks: number;
}> = {}) => ({
  online: true,
  active: true,
  errors: 0,
  receiptChecks: 0,
  ...overrides,
});

describe('job policy', () => {
  describe('pollDelay', () => {
    it.each(['processing', 'queued', 'requested', 'validating', 'generating', 'rendering', 'evaluating', 'delivering'])(
      'polls active status %s every four seconds', (status) => {
        expect(pollDelay(makeJob({ status }), pollOptions())).toBe(4_000);
      },
    );

    it('continues polling cleanup after any terminal status', () => {
      expect(pollDelay(makeJob({ status: 'accepted', cleanup_pending: true }), pollOptions())).toBe(4_000);
      expect(pollDelay(makeJob({ status: 'failed', cleanup_pending: true }), pollOptions())).toBe(4_000);
    });

    it('does not poll while offline or in the background', () => {
      expect(pollDelay(makeJob(), pollOptions({ online: false }))).toBe(false);
      expect(pollDelay(makeJob(), pollOptions({ active: false }))).toBe(false);
      expect(pollDelay(makeJob({ status: 'accepted', cleanup_pending: true }), pollOptions({ active: false }))).toBe(false);
    });

    it('uses exponential error backoff capped at thirty seconds', () => {
      expect(pollDelay(undefined, pollOptions({ errors: 0 }))).toBe(4_000);
      expect(pollDelay(undefined, pollOptions({ errors: 1 }))).toBe(8_000);
      expect(pollDelay(undefined, pollOptions({ errors: 2 }))).toBe(16_000);
      expect(pollDelay(undefined, pollOptions({ errors: 3 }))).toBe(30_000);
      expect(pollDelay(undefined, pollOptions({ errors: 30 }))).toBe(30_000);
    });

    it('limits unconfirmed acceptance receipt checks to eight', () => {
      const accepted = makeJob({ status: 'accepted', photon_accepted: true, provider_message_id: 'message-1' });
      expect(pollDelay(accepted, pollOptions({ receiptChecks: 0 }))).toBe(4_000);
      expect(pollDelay(accepted, pollOptions({ receiptChecks: 7 }))).toBe(4_000);
      expect(pollDelay(accepted, pollOptions({ receiptChecks: 8 }))).toBe(false);
    });

    it('polls for read only with valid acceptance evidence and read timestamp', () => {
      const read = makeJob({
        status: 'accepted', photon_accepted: true, provider_message_id: 'message-1',
        receipt_status: 'read', read_at: '2026-05-04T12:00:00Z',
      });
      expect(pollDelay(read, pollOptions())).toBe(false);
      expect(pollDelay(makeJob({ ...read, photon_accepted: false }), pollOptions())).toBe(4_000);
      expect(pollDelay(makeJob({ ...read, provider_message_id: null }), pollOptions())).toBe(4_000);
      expect(pollDelay(makeJob({ ...read, read_at: 'not-a-date' }), pollOptions())).toBe(4_000);
      expect(pollDelay(makeJob({ ...read, receipt_status: 'unconfirmed' }), pollOptions())).toBe(4_000);
    });

    it('does not automatically poll unknown statuses', () => {
      expect(pollDelay(makeJob({ status: 'future_status' }), pollOptions())).toBe(false);
      expect(pollDelay(makeJob({ status: 'future_status', cleanup_pending: true }), pollOptions())).toBe(4_000);
    });
  });

  describe('terminal outcomes and messages', () => {
    it.each(['needs_breakdown', 'accepted', 'failed', 'cancelled', 'interrupted', 'delivery_unknown'])(
      'recognizes %s as terminal', (status) => {
        expect(isTerminal(makeJob({ status }))).toBe(true);
      },
    );

    it('does not call active or unknown statuses terminal', () => {
      expect(isTerminal(makeJob({ status: 'rendering' }))).toBe(false);
      expect(isTerminal(makeJob({ status: 'future_status' }))).toBe(false);
    });

    it('uses scope feedback for needs_breakdown', () => {
      expect(jobMessage(makeJob({ status: 'needs_breakdown', feedback: 'Split into two lessons.' })))
        .toBe('Split into two lessons.');
    });

    it('distinguishes accepted from a confirmed read receipt', () => {
      const accepted = makeJob({ status: 'accepted', photon_accepted: true, provider_message_id: 'message-1' });
      expect(jobMessage(accepted)).toContain('Photon accepted');
      expect(jobMessage(accepted)).toContain('does not confirm that it was read');
      expect(jobMessage(makeJob({
        ...accepted, receipt_status: 'read', read_at: '2026-05-04T12:00:00Z',
      }))).toContain('recipient read');
      expect(jobMessage(makeJob({
        ...accepted, photon_accepted: false, receipt_status: 'read', read_at: '2026-05-04T12:00:00Z',
      }))).toContain('A read receipt has not been confirmed');
    });

    it('explains cancellation, interruption, failure, and uncertain send outcomes', () => {
      expect(jobMessage(makeJob({ status: 'cancelled' }))).toContain('before messaging started');
      expect(jobMessage(makeJob({ status: 'interrupted' }))).toContain('will not resume automatically');
      expect(jobMessage(makeJob({ status: 'failed', failure_reason: 'rendering failed' }))).toContain('rendering failed');
      expect(jobMessage(makeJob({ status: 'delivery_unknown' }))).toContain('Do not retry automatically');
      expect(jobMessage(makeJob({ status: 'delivering' }))).toContain('cancellation is no longer available');
    });

    it('shows unknown status without implying success', () => {
      const message = jobMessage(makeJob({ status: 'future_status' }));
      expect(message).toContain('Unknown job status');
      expect(message).toContain('outcome is not confirmed');
      expect(message).not.toContain('accepted');
    });
  });

  describe('canCancel', () => {
    it.each(['processing', 'queued', 'requested', 'validating', 'generating', 'rendering', 'evaluating'])(
      'allows cancellation during pre-send status %s', (status) => {
        expect(canCancel(makeJob({ status }))).toBe(true);
      },
    );

    it('disables cancellation after request or at the messaging cutoff', () => {
      expect(canCancel(makeJob({ cancel_requested: true }))).toBe(false);
      expect(canCancel(makeJob({ status: 'delivering' }))).toBe(false);
      expect(canCancel(makeJob({ status: 'accepted' }))).toBe(false);
      expect(canCancel(makeJob({ status: 'delivery_unknown' }))).toBe(false);
    });

    it('does not offer cancellation for other terminal or unknown statuses', () => {
      expect(canCancel(makeJob({ status: 'cancelled' }))).toBe(false);
      expect(canCancel(makeJob({ status: 'future_status' }))).toBe(false);
    });
  });
});
