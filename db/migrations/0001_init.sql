CREATE TABLE users (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', (random() & 3) + 1, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))),
  email TEXT COLLATE NOCASE UNIQUE NOT NULL CHECK (length(email) <= 254),
  settings TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER))
) STRICT;

CREATE TABLE usage_periods (
  user_id TEXT NOT NULL REFERENCES users ON DELETE CASCADE,
  period TEXT NOT NULL,
  used_micros INTEGER NOT NULL DEFAULT 0,
  reserved_micros INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, period)
) STRICT;

CREATE TABLE llm_calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users ON DELETE CASCADE,
  kind TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  cost_micros INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER))
) STRICT;
CREATE INDEX llm_calls_user_created_idx ON llm_calls (user_id, created_at DESC);

CREATE TABLE topics (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', (random() & 3) + 1, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))),
  user_id TEXT NOT NULL REFERENCES users ON DELETE CASCADE,
  slug TEXT NOT NULL CHECK (length(slug) <= 64),
  name TEXT NOT NULL CHECK (length(name) <= 120),
  domain TEXT NOT NULL,
  mastery REAL NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  correct INTEGER NOT NULL DEFAULT 0,
  conf_err_sum REAL NOT NULL DEFAULT 0,
  last_seen_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  UNIQUE (user_id, slug)
) STRICT;
CREATE INDEX topics_user_seen_idx ON topics (user_id, last_seen_at DESC, id);

CREATE TABLE topic_edges (
  user_id TEXT NOT NULL REFERENCES users ON DELETE CASCADE,
  src TEXT NOT NULL REFERENCES topics ON DELETE CASCADE,
  dst TEXT NOT NULL REFERENCES topics ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('prereq', 'related')),
  PRIMARY KEY (user_id, src, dst, kind),
  CHECK (src <> dst)
) STRICT;
CREATE INDEX topic_edges_dst_idx ON topic_edges (dst);
CREATE INDEX topic_edges_src_idx ON topic_edges (src);

CREATE TABLE lessons (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', (random() & 3) + 1, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))),
  user_id TEXT NOT NULL REFERENCES users ON DELETE CASCADE,
  topic_id TEXT NOT NULL REFERENCES topics ON DELETE CASCADE,
  title TEXT NOT NULL,
  plan TEXT NOT NULL,
  paper_ids TEXT NOT NULL DEFAULT '[]',
  model TEXT NOT NULL,
  expires_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER))
) STRICT;
CREATE INDEX lessons_user_created_idx ON lessons (user_id, created_at DESC);
CREATE INDEX lessons_topic_idx ON lessons (topic_id);
CREATE INDEX lessons_expires_idx ON lessons (expires_at) WHERE expires_at IS NOT NULL;

CREATE TABLE lesson_steps (
  lesson_id TEXT NOT NULL REFERENCES lessons ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  content TEXT NOT NULL,
  PRIMARY KEY (lesson_id, idx)
) STRICT;

CREATE TABLE conversations (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', (random() & 3) + 1, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))),
  user_id TEXT NOT NULL REFERENCES users ON DELETE CASCADE,
  lesson_id TEXT UNIQUE REFERENCES lessons ON DELETE CASCADE,
  created_at INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER))
) STRICT;
CREATE INDEX conversations_user_idx ON conversations (user_id);

CREATE TABLE messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conv_id TEXT NOT NULL REFERENCES conversations ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL CHECK (length(content) <= 20000),
  citations TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER))
) STRICT;
CREATE INDEX messages_conv_idx ON messages (conv_id, id);

CREATE TABLE styles (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', (random() & 3) + 1, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))),
  user_id TEXT NOT NULL REFERENCES users ON DELETE CASCADE,
  mime TEXT NOT NULL CHECK (mime IN ('application/pdf', 'image/png')),
  sha256 BLOB NOT NULL,
  size INTEGER NOT NULL,
  profile TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  UNIQUE (user_id, sha256)
) STRICT;

CREATE TABLE questions (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', (random() & 3) + 1, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))),
  user_id TEXT NOT NULL REFERENCES users ON DELETE CASCADE,
  topic_id TEXT NOT NULL REFERENCES topics ON DELETE CASCADE,
  lesson_id TEXT REFERENCES lessons ON DELETE SET NULL,
  style_id TEXT REFERENCES styles ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('mcq', 'free', 'code')),
  category TEXT CHECK (category IN ('terminology', 'conceptual', 'mcq', 'free')),
  stem TEXT NOT NULL,
  choices TEXT,
  code_spec TEXT,
  answer TEXT NOT NULL,
  explanation TEXT NOT NULL,
  citations TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  CHECK ((kind = 'code') = (code_spec IS NOT NULL))
) STRICT;
CREATE INDEX questions_user_topic_idx ON questions (user_id, topic_id);
CREATE INDEX questions_lesson_idx ON questions (lesson_id) WHERE lesson_id IS NOT NULL;
CREATE INDEX questions_topic_idx ON questions (topic_id);
CREATE INDEX questions_style_idx ON questions (style_id) WHERE style_id IS NOT NULL;

CREATE TABLE cards (
  question_id TEXT PRIMARY KEY REFERENCES questions ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users ON DELETE CASCADE,
  ef REAL NOT NULL DEFAULT 2.5,
  interval_d INTEGER NOT NULL DEFAULT 0,
  reps INTEGER NOT NULL DEFAULT 0,
  lapses INTEGER NOT NULL DEFAULT 0,
  due_at INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER))
) STRICT;
CREATE INDEX cards_user_due_idx ON cards (user_id, due_at);

CREATE TABLE attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users ON DELETE CASCADE,
  question_id TEXT NOT NULL REFERENCES questions ON DELETE CASCADE,
  topic_id TEXT NOT NULL,
  score REAL CHECK (score BETWEEN 0 AND 1),
  confidence INTEGER CHECK (confidence BETWEEN 0 AND 100),
  latency_ms INTEGER,
  response TEXT CHECK (response IS NULL OR length(response) <= 5000),
  is_review INTEGER NOT NULL CHECK (is_review IN (0, 1)),
  created_at INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER))
) STRICT;
CREATE INDEX attempts_user_created_idx ON attempts (user_id, created_at DESC);
CREATE INDEX attempts_question_idx ON attempts (question_id);
CREATE INDEX attempts_user_topic_created_idx ON attempts (user_id, topic_id, created_at, id);

CREATE TABLE daily_activity (
  user_id TEXT NOT NULL REFERENCES users ON DELETE CASCADE,
  day TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  correct INTEGER NOT NULL DEFAULT 0,
  reviews INTEGER NOT NULL DEFAULT 0,
  review_correct INTEGER NOT NULL DEFAULT 0,
  conf_err_sum REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
) STRICT;

CREATE TABLE papers (
  id TEXT PRIMARY KEY,
  doi TEXT,
  title TEXT NOT NULL,
  year INTEGER,
  venue TEXT,
  abstract TEXT,
  fetched_at INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER))
) STRICT;

CREATE TABLE retrieval_cache (
  qhash BLOB PRIMARY KEY,
  paper_ids TEXT NOT NULL,
  fetched_at INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER))
) STRICT;

CREATE TABLE insights (
  user_id TEXT NOT NULL REFERENCES users ON DELETE CASCADE,
  day TEXT NOT NULL,
  body TEXT NOT NULL,
  PRIMARY KEY (user_id, day)
) STRICT;

INSERT INTO users (id, email, settings, created_at) VALUES ('00000000-0000-4000-8000-000000000001', 'local@localhost', '{}', 0);
