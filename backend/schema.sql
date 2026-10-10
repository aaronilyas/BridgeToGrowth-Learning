-- PostgreSQL schema for BridgeToGrowth-Learning.
-- Video bytes and temporary render paths are intentionally not persisted here.

BEGIN;

CREATE TABLE users (
    id UUID PRIMARY KEY,
    phone_number VARCHAR(32) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_users_phone_number UNIQUE (phone_number)
);

CREATE TABLE user_containers (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    container_handle VARCHAR(255),
    status VARCHAR(16) NOT NULL DEFAULT 'stopped',
    last_authenticated_request_at TIMESTAMPTZ,
    started_at TIMESTAMPTZ,
    stopped_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_user_containers_user_id UNIQUE (user_id),
    CONSTRAINT uq_user_containers_handle UNIQUE (container_handle),
    CONSTRAINT ck_user_containers_status
        CHECK (status IN ('stopped', 'starting', 'running', 'stopping', 'error'))
);

CREATE INDEX ix_user_containers_status_last_request
    ON user_containers (status, last_authenticated_request_at);

CREATE TABLE lesson_jobs (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    original_request TEXT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'requested',
    estimated_duration_seconds INTEGER,
    scope_feedback TEXT,
    failure_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ,
    CONSTRAINT ck_lesson_jobs_status CHECK (status IN (
        'requested', 'validating', 'needs_breakdown', 'queued', 'generating',
        'rendering', 'evaluating', 'delivering', 'delivered', 'failed', 'cancelled'
    )),
    CONSTRAINT ck_lesson_jobs_estimated_duration_nonnegative
        CHECK (estimated_duration_seconds IS NULL OR estimated_duration_seconds >= 0)
);

CREATE INDEX ix_lesson_jobs_user_created ON lesson_jobs (user_id, created_at);
CREATE INDEX ix_lesson_jobs_status_created ON lesson_jobs (status, created_at);

CREATE TABLE video_deliveries (
    id UUID PRIMARY KEY,
    lesson_job_id UUID NOT NULL REFERENCES lesson_jobs(id) ON DELETE CASCADE,
    status VARCHAR(16) NOT NULL DEFAULT 'pending',
    provider_message_id VARCHAR(255),
    failure_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    accepted_at TIMESTAMPTZ,
    delivered_at TIMESTAMPTZ,
    CONSTRAINT ck_video_deliveries_status
        CHECK (status IN ('pending', 'accepted', 'delivered', 'failed'))
);

CREATE INDEX ix_video_deliveries_job_created ON video_deliveries (lesson_job_id, created_at);

COMMIT;
