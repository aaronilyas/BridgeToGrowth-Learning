DROP INDEX lessons_expires_idx;
ALTER TABLE lessons DROP COLUMN expires_at;
DROP TABLE llm_calls;
DROP TABLE usage_periods;
