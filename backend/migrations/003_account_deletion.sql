-- Apply after 002, with coordinator drained/stopped and a verified backup.
-- Additive only; deletion happens solely after an authenticated user request.
BEGIN;
ALTER TABLE users ADD COLUMN deletion_requested_at TIMESTAMPTZ;
COMMIT;
