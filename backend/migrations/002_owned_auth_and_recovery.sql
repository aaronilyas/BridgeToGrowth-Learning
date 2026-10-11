-- Apply AFTER 001, with the coordinator stopped and a backup.
-- UUIDs and all existing foreign keys are preserved. No credentials/verification fabricated.
BEGIN;
LOCK TABLE users, lesson_jobs, video_deliveries, user_containers IN ACCESS EXCLUSIVE MODE;
ALTER TABLE users ADD COLUMN password_hash TEXT,
 ADD COLUMN phone_verified_at TIMESTAMPTZ,
 ADD COLUMN enrollment_hash VARCHAR(64), ADD COLUMN enrollment_expires_at TIMESTAMPTZ;
ALTER TABLE lesson_jobs ADD COLUMN idempotency_key VARCHAR(128),
 ADD COLUMN request_hash VARCHAR(64), ADD COLUMN voiceover BOOLEAN NOT NULL DEFAULT false,
 ADD COLUMN cancel_requested BOOLEAN NOT NULL DEFAULT false,
 ADD COLUMN cleanup_required BOOLEAN NOT NULL DEFAULT false,
 ADD COLUMN evaluation JSON, ADD COLUMN rendered_duration_seconds VARCHAR(32),
 ADD CONSTRAINT uq_lesson_jobs_idempotency UNIQUE(user_id, idempotency_key);
ALTER TABLE lesson_jobs DROP CONSTRAINT ck_lesson_jobs_status;
ALTER TABLE lesson_jobs ADD CONSTRAINT ck_lesson_jobs_status CHECK(status IN (
 'requested', 'validating', 'needs_breakdown', 'queued', 'generating',
 'rendering', 'evaluating', 'delivering', 'accepted', 'failed', 'cancelled', 'interrupted', 'delivery_unknown'));
-- Protect old interrupted work until startup reconciliation observes process state.
UPDATE lesson_jobs SET cleanup_required = true WHERE status NOT IN ('needs_breakdown','accepted','failed','cancelled');
ALTER TABLE video_deliveries ADD COLUMN recipient_phone VARCHAR(32), ADD COLUMN read_at TIMESTAMPTZ;
-- Historical phone was not captured at send time; do not fabricate receipt attribution.
-- Ambiguous reused provider IDs must be reviewed rather than assigning a receipt to two lessons.
ALTER TABLE video_deliveries ADD CONSTRAINT uq_video_deliveries_provider_message_id UNIQUE(provider_message_id);

CREATE TABLE auth_sessions (
    id UUID NOT NULL,
    user_id UUID NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    revoked_at TIMESTAMP WITH TIME ZONE,
    PRIMARY KEY (id),
    FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
);
CREATE INDEX ix_auth_sessions_user_id ON auth_sessions (user_id);

CREATE TABLE auth_tokens (
    token_hash VARCHAR(64) NOT NULL,
    session_id UUID NOT NULL,
    kind VARCHAR(8) NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    used_at TIMESTAMP WITH TIME ZONE,
    PRIMARY KEY (token_hash),
    FOREIGN KEY(session_id) REFERENCES auth_sessions (id) ON DELETE CASCADE
);
CREATE INDEX ix_auth_tokens_session_id ON auth_tokens (session_id);

CREATE TABLE auth_verifications (
    id UUID NOT NULL,
    user_id UUID,
    phone_number VARCHAR(32) NOT NULL,
    purpose VARCHAR(16) NOT NULL,
    code_hash VARCHAR(64) NOT NULL,
    password_hash TEXT,
    credential_snapshot TEXT,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    sent_at TIMESTAMP WITH TIME ZONE NOT NULL,
    attempts INTEGER NOT NULL,
    consumed_at TIMESTAMP WITH TIME ZONE,
    eligible BOOLEAN NOT NULL,
    PRIMARY KEY (id),
    FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
);
CREATE INDEX ix_auth_verifications_user_id ON auth_verifications (user_id);

CREATE TABLE auth_rates (
    key VARCHAR(64) NOT NULL,
    window_start TIMESTAMP WITH TIME ZONE NOT NULL,
    count INTEGER NOT NULL,
    PRIMARY KEY (key)
);

CREATE TABLE receipt_events (
    event_id VARCHAR(255) NOT NULL,
    provider_message_id VARCHAR(255) NOT NULL,
    recipient_phone VARCHAR(32) NOT NULL,
    read_at TIMESTAMP WITH TIME ZONE NOT NULL,
    received_at TIMESTAMP WITH TIME ZONE NOT NULL,
    PRIMARY KEY (event_id)
);
CREATE INDEX ix_receipt_events_provider_message_id ON receipt_events (provider_message_id);
COMMIT;
