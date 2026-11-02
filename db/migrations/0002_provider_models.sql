CREATE TABLE provider_models (
  provider TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  fetched_at INTEGER NOT NULL
) STRICT;
