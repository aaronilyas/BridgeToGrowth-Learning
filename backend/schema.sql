-- Fresh PostgreSQL schema. Metadata only; no generated videos.
BEGIN;

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

CREATE TABLE users (
    id UUID NOT NULL,
    phone_number VARCHAR(32) NOT NULL,
    password_hash TEXT,
    phone_verified_at TIMESTAMP WITH TIME ZONE,
    enrollment_hash VARCHAR(64),
    enrollment_expires_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    PRIMARY KEY (id),
    CONSTRAINT uq_users_phone_number UNIQUE (phone_number)
);

CREATE TABLE auth_sessions (
    id UUID NOT NULL,
    user_id UUID NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    revoked_at TIMESTAMP WITH TIME ZONE,
    PRIMARY KEY (id),
    FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
);
CREATE INDEX ix_auth_sessions_user_id ON auth_sessions (user_id);

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

CREATE TABLE lesson_jobs (
    id UUID NOT NULL,
    user_id UUID NOT NULL,
    original_request TEXT NOT NULL,
    status VARCHAR(20) DEFAULT 'requested' NOT NULL,
    idempotency_key VARCHAR(128),
    request_hash VARCHAR(64),
    voiceover BOOLEAN DEFAULT 'false' NOT NULL,
    cancel_requested BOOLEAN DEFAULT 'false' NOT NULL,
    cleanup_required BOOLEAN DEFAULT 'false' NOT NULL,
    evaluation JSON,
    rendered_duration_seconds VARCHAR(32),
    estimated_duration_seconds INTEGER,
    scope_feedback TEXT,
    failure_reason TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    completed_at TIMESTAMP WITH TIME ZONE,
    PRIMARY KEY (id),
    CONSTRAINT ck_lesson_jobs_status CHECK (status IN ('requested', 'validating', 'needs_breakdown', 'queued', 'generating', 'rendering', 'evaluating', 'delivering', 'accepted', 'failed', 'cancelled', 'interrupted', 'delivery_unknown')),
    CONSTRAINT ck_lesson_jobs_estimated_duration_nonnegative CHECK (estimated_duration_seconds IS NULL OR estimated_duration_seconds >= 0),
    CONSTRAINT uq_lesson_jobs_idempotency UNIQUE (user_id, idempotency_key),
    FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
);
CREATE INDEX ix_lesson_jobs_user_created ON lesson_jobs (user_id, created_at);
CREATE INDEX ix_lesson_jobs_status_created ON lesson_jobs (status, created_at);

CREATE TABLE user_containers (
    id UUID NOT NULL,
    user_id UUID NOT NULL,
    container_handle VARCHAR(255),
    status VARCHAR(16) DEFAULT 'stopped' NOT NULL,
    last_authenticated_request_at TIMESTAMP WITH TIME ZONE,
    started_at TIMESTAMP WITH TIME ZONE,
    stopped_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    PRIMARY KEY (id),
    CONSTRAINT uq_user_containers_user_id UNIQUE (user_id),
    CONSTRAINT uq_user_containers_handle UNIQUE (container_handle),
    CONSTRAINT ck_user_containers_status CHECK (status IN ('stopped', 'starting', 'running', 'stopping', 'error')),
    FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
);
CREATE INDEX ix_user_containers_status_last_request ON user_containers (status, last_authenticated_request_at);

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

CREATE TABLE video_deliveries (
    id UUID NOT NULL,
    lesson_job_id UUID NOT NULL,
    status VARCHAR(16) DEFAULT 'pending' NOT NULL,
    provider_message_id VARCHAR(255),
    recipient_phone VARCHAR(32),
    read_at TIMESTAMP WITH TIME ZONE,
    failure_reason TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    accepted_at TIMESTAMP WITH TIME ZONE,
    delivered_at TIMESTAMP WITH TIME ZONE,
    PRIMARY KEY (id),
    CONSTRAINT ck_video_deliveries_status CHECK (status IN ('pending', 'accepted', 'failed')),
    FOREIGN KEY(lesson_job_id) REFERENCES lesson_jobs (id) ON DELETE CASCADE,
    UNIQUE (provider_message_id)
);
CREATE INDEX ix_video_deliveries_job_created ON video_deliveries (lesson_job_id, created_at);
COMMIT;
