-- Apply once to the pre-acceptance schema, with the coordinator drained/stopped.
-- Historical pipeline completion is not receipt evidence. Preserve metadata.
BEGIN;
LOCK TABLE lesson_jobs, video_deliveries IN ACCESS EXCLUSIVE MODE;
ALTER TABLE lesson_jobs DROP CONSTRAINT ck_lesson_jobs_status;
ALTER TABLE lesson_jobs ADD CONSTRAINT ck_lesson_jobs_status CHECK (status IN (
    'requested', 'validating', 'needs_breakdown', 'queued', 'generating',
    'rendering', 'evaluating', 'delivering', 'accepted', 'delivered', 'failed', 'cancelled'
));
UPDATE lesson_jobs AS job
SET status = 'accepted', completed_at = COALESCE(job.completed_at, evidence.accepted_at)
FROM (
    SELECT lesson_job_id, min(accepted_at) AS accepted_at
    FROM video_deliveries
    WHERE status IN ('accepted', 'delivered') AND accepted_at IS NOT NULL
      AND provider_message_id IS NOT NULL AND btrim(provider_message_id) <> ''
    GROUP BY lesson_job_id
) AS evidence
WHERE job.id = evidence.lesson_job_id AND job.status IN ('delivered', 'delivering');
UPDATE lesson_jobs
SET status = 'failed', completed_at = COALESCE(completed_at, now()),
    failure_reason = COALESCE(failure_reason, 'Legacy completion lacks confirmed Photon acceptance; operator review required')
WHERE status = 'delivered';
COMMIT;
