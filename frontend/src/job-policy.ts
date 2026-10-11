export interface Job {
  id: string;
  status: string;
  estimated_duration_seconds: number | null;
  rendered_duration_seconds: number | null;
  feedback: string | null;
  failure_reason: string | null;
  evaluation: {
    approved: boolean;
    accurate: boolean;
    defect_free: boolean;
    consistent: boolean;
    findings: string;
    narration_accurate?: boolean;
    narration_intelligible?: boolean;
    narration_consistent?: boolean;
  } | null;
  cancel_requested: boolean;
  cleanup_pending: boolean;
  photon_accepted: boolean;
  provider_message_id: string | null;
  receipt_status: string;
  read_at: string | null;
}

const TERMINAL_STATUSES = new Set([
  'needs_breakdown',
  'accepted',
  'failed',
  'cancelled',
  'interrupted',
  'delivery_unknown',
]);

const ACTIVE_STATUSES = new Set([
  'queued',
  'requested', // Legacy status recognized during recovery.
  'validating',
  'generating',
  'rendering',
  'evaluating',
  'delivering',
]);

const POLL_INTERVAL_MS = 4_000;
const MAX_ERROR_DELAY_MS = 30_000;
const MAX_RECEIPT_CHECKS = 8;

export function isTerminal(job: Job): boolean {
  return TERMINAL_STATUSES.has(job.status);
}

/** Whether the current snapshot is still before the backend's messaging cutoff. */
export function canCancel(job: Job): boolean {
  return ACTIVE_STATUSES.has(job.status)
    && job.status !== 'delivering'
    && !job.cancel_requested;
}

function hasConfirmedRead(job: Job): boolean {
  if (!job.photon_accepted
    || !job.provider_message_id?.trim()
    || job.receipt_status !== 'read'
    || !job.read_at?.trim()) {
    return false;
  }

  return Number.isFinite(Date.parse(job.read_at));
}

export function jobMessage(job: Job): string {
  switch (job.status) {
    case 'queued':
    case 'requested':
      return job.cancel_requested
        ? 'Cancellation requested. Waiting for the job to stop and clean up.'
        : 'Your lesson is queued and waiting to start.';
    case 'validating':
      return job.cancel_requested
        ? 'Cancellation requested. The current check must finish before the job can stop.'
        : 'Checking the request and estimating the lesson length.';
    case 'needs_breakdown':
      return job.feedback || 'This lesson is too long for one request. Please split it into smaller topics.';
    case 'generating':
      return job.cancel_requested
        ? 'Cancellation requested. Stopping lesson generation and cleaning up.'
        : 'Generating the lesson.';
    case 'rendering':
      return job.cancel_requested
        ? 'Cancellation requested. Stopping the render and cleaning up.'
        : 'Rendering the lesson video.';
    case 'evaluating':
      return job.cancel_requested
        ? 'Cancellation requested. The evaluation is finishing; the lesson will not be sent.'
        : 'Checking the rendered lesson before sending it.';
    case 'delivering':
      return 'Photon is processing the send. Acceptance is not confirmed yet, and cancellation is no longer available.';
    case 'accepted':
      if (hasConfirmedRead(job)) {
        return `The recipient read the lesson at ${job.read_at}.`;
      }
      return 'Photon accepted the lesson message. A read receipt has not been confirmed; this does not confirm that it was read.';
    case 'failed':
      return job.failure_reason
        ? `The lesson could not be completed before message acceptance: ${job.failure_reason}`
        : 'The lesson could not be completed before message acceptance. No accepted message is confirmed.';
    case 'cancelled':
      return 'The lesson was cancelled before messaging started. No message was sent.';
    case 'interrupted':
      return 'The coordinator stopped before messaging began. The lesson will not resume automatically.';
    case 'delivery_unknown':
      return 'The send may have been accepted, but acceptance could not be confirmed. Do not retry automatically; a second message could be sent.';
    default:
      return `Unknown job status “${job.status}”. The outcome is not confirmed; do not assume the lesson was sent.`;
  }
}

export function pollDelay(
  job: Job | undefined,
  options: { online: boolean; active: boolean; errors: number; receiptChecks: number },
): number | false {
  if (!options.online || !options.active) return false;

  const errorCount = Number.isFinite(options.errors)
    ? Math.max(0, Math.floor(options.errors))
    : 0;
  const delay = errorCount >= 3
    ? MAX_ERROR_DELAY_MS
    : Math.min(MAX_ERROR_DELAY_MS, POLL_INTERVAL_MS * 2 ** errorCount);

  if (!job) return delay;

  // A terminal outcome can still have durable renderer cleanup to reconcile.
  if (job.cleanup_pending) return delay;

  if (ACTIVE_STATUSES.has(job.status)) return delay;

  // Acceptance is terminal for the job. Poll only briefly for explicit read
  // evidence; never infer delivery or reading from elapsed time.
  if (job.status === 'accepted' && !hasConfirmedRead(job)) {
    const checks = Number.isFinite(options.receiptChecks)
      ? Math.max(0, Math.floor(options.receiptChecks))
      : MAX_RECEIPT_CHECKS;
    return checks < MAX_RECEIPT_CHECKS ? delay : false;
  }

  // Unknown statuses do not imply success and are left to manual refresh.
  return false;
}
