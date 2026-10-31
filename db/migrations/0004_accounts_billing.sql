ALTER TABLE users DROP COLUMN IF EXISTS trial_ends_at;

ALTER TABLE lessons ADD COLUMN IF NOT EXISTS expires_at timestamptz;
CREATE INDEX IF NOT EXISTS lessons_expires_idx ON lessons (expires_at) WHERE expires_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS stripe_events_received_idx ON stripe_events (received_at);
