-- Apply once to databases created with the original backend/schema.sql.
-- Stop the API coordinator first. No videos or receipt claims are introduced.
BEGIN;
LOCK TABLE lesson_jobs, video_deliveries IN ACCESS EXCLUSIVE MODE;

ALTER TABLE lesson_jobs DROP CONSTRAINT ck_lesson_jobs_status;
ALTER TABLE video_deliveries DROP CONSTRAINT ck_video_deliveries_status;

-- The old service never wrote delivery status 'delivered'. If external/legacy
-- records contain it, retain acceptance only when acceptance metadata exists.
-- Normalize malformed accepted rows too, since public polling uses them as proof.
-- Preserve delivered_at for historical inspection, never as receipt evidence.
UPDATE video_deliveries
SET status = CASE WHEN accepted_at IS NOT NULL
                       AND provider_message_id IS NOT NULL
                       AND btrim(provider_message_id) <> ''
                  THEN 'accepted' ELSE 'failed' END,
    failure_reason = CASE WHEN accepted_at IS NOT NULL
                               AND provider_message_id IS NOT NULL
                               AND btrim(provider_message_id) <> ''
                          THEN failure_reason ELSE 'Legacy acceptance not confirmed' END
WHERE status = 'delivered'
   OR (status = 'accepted' AND (accepted_at IS NULL
       OR provider_message_id IS NULL OR btrim(provider_message_id) = ''));

-- Old job 'delivered' meant pipeline completion, not confirmed user receipt.
-- Do not invent acceptance for a job with no associated acceptance evidence.
UPDATE lesson_jobs AS job
SET status = CASE WHEN EXISTS (
        SELECT 1 FROM video_deliveries AS delivery
        WHERE delivery.lesson_job_id = job.id AND delivery.status = 'accepted'
          AND delivery.accepted_at IS NOT NULL
          AND delivery.provider_message_id IS NOT NULL
          AND btrim(delivery.provider_message_id) <> ''
    ) THEN 'accepted' ELSE 'failed' END,
    failure_reason = CASE WHEN EXISTS (
        SELECT 1 FROM video_deliveries AS delivery
        WHERE delivery.lesson_job_id = job.id AND delivery.status = 'accepted'
          AND delivery.accepted_at IS NOT NULL
          AND delivery.provider_message_id IS NOT NULL
          AND btrim(delivery.provider_message_id) <> ''
    ) THEN job.failure_reason ELSE 'Legacy acceptance not confirmed' END
WHERE job.status = 'delivered';

ALTER TABLE lesson_jobs ADD CONSTRAINT ck_lesson_jobs_status CHECK (status IN (
    'requested', 'validating', 'needs_breakdown', 'queued', 'generating',
    'rendering', 'evaluating', 'delivering', 'accepted', 'failed', 'cancelled'
));
ALTER TABLE video_deliveries ADD CONSTRAINT ck_video_deliveries_status
    CHECK (status IN ('pending', 'accepted', 'failed'));

COMMIT;
