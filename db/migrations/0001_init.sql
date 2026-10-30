CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email citext UNIQUE NOT NULL CHECK (char_length(email::text) <= 254),
  pw_hash text NOT NULL,
  settings jsonb NOT NULL DEFAULT '{}',
  trial_ends_at timestamptz NOT NULL,
  stripe_customer_id text UNIQUE,
  sub_id text UNIQUE,
  sub_status text NOT NULL DEFAULT 'none' CHECK (sub_status IN ('none','active','trialing','past_due','canceled','incomplete','unpaid')),
  sub_period_end timestamptz,
  sub_cancel_at_period_end boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  id_hash bytea PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id);
CREATE INDEX IF NOT EXISTS sessions_expires_idx ON sessions (expires_at);

CREATE TABLE IF NOT EXISTS stripe_events (
  id text PRIMARY KEY,
  received_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS usage_periods (
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  period date NOT NULL,
  used_micros bigint NOT NULL DEFAULT 0,
  reserved_micros bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, period)
);

CREATE TABLE IF NOT EXISTS llm_calls (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  kind text NOT NULL,
  model text NOT NULL,
  prompt_tokens int,
  completion_tokens int,
  cost_micros bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS llm_calls_user_created_idx ON llm_calls (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS topics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  slug text NOT NULL CHECK (char_length(slug) <= 64),
  name text NOT NULL CHECK (char_length(name) <= 120),
  domain text NOT NULL,
  mastery real NOT NULL DEFAULT 0,
  attempts int NOT NULL DEFAULT 0,
  correct int NOT NULL DEFAULT 0,
  conf_err_sum real NOT NULL DEFAULT 0,
  last_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, slug)
);
CREATE INDEX IF NOT EXISTS topics_user_seen_idx ON topics (user_id, last_seen_at DESC);

CREATE TABLE IF NOT EXISTS topic_edges (
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  src uuid NOT NULL REFERENCES topics ON DELETE CASCADE,
  dst uuid NOT NULL REFERENCES topics ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('prereq','related')),
  PRIMARY KEY (user_id, src, dst, kind),
  CHECK (src <> dst)
);

CREATE TABLE IF NOT EXISTS lessons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  topic_id uuid NOT NULL REFERENCES topics ON DELETE CASCADE,
  title text NOT NULL,
  plan jsonb NOT NULL,
  paper_ids text[] NOT NULL DEFAULT '{}',
  model text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lessons_user_created_idx ON lessons (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS lesson_steps (
  lesson_id uuid NOT NULL REFERENCES lessons ON DELETE CASCADE,
  idx smallint NOT NULL,
  content jsonb NOT NULL,
  PRIMARY KEY (lesson_id, idx)
);

CREATE TABLE IF NOT EXISTS conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  lesson_id uuid UNIQUE REFERENCES lessons ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS messages (
  id bigserial PRIMARY KEY,
  conv_id uuid NOT NULL REFERENCES conversations ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user','assistant')),
  content text NOT NULL CHECK (char_length(content) <= 20000),
  citations jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS messages_conv_idx ON messages (conv_id, id);

CREATE TABLE IF NOT EXISTS styles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  mime text NOT NULL CHECK (mime IN ('application/pdf','image/png')),
  sha256 bytea NOT NULL,
  size int NOT NULL,
  profile jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, sha256)
);

CREATE TABLE IF NOT EXISTS questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  topic_id uuid NOT NULL REFERENCES topics ON DELETE CASCADE,
  lesson_id uuid REFERENCES lessons ON DELETE SET NULL,
  style_id uuid REFERENCES styles ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('mcq','free')),
  stem text NOT NULL,
  choices jsonb,
  answer jsonb NOT NULL,
  explanation text NOT NULL,
  citations jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS questions_user_topic_idx ON questions (user_id, topic_id);

CREATE TABLE IF NOT EXISTS cards (
  question_id uuid PRIMARY KEY REFERENCES questions ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  ef real NOT NULL DEFAULT 2.5,
  interval_d int NOT NULL DEFAULT 0,
  reps int NOT NULL DEFAULT 0,
  lapses int NOT NULL DEFAULT 0,
  due_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cards_user_due_idx ON cards (user_id, due_at);

CREATE TABLE IF NOT EXISTS attempts (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  question_id uuid NOT NULL REFERENCES questions ON DELETE CASCADE,
  topic_id uuid NOT NULL,
  score real CHECK (score BETWEEN 0 AND 1),
  confidence smallint CHECK (confidence BETWEEN 0 AND 100),
  latency_ms int,
  response text CHECK (char_length(response) <= 5000),
  is_review boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS attempts_user_created_idx ON attempts (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS daily_activity (
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  day date NOT NULL,
  attempts int NOT NULL DEFAULT 0,
  correct int NOT NULL DEFAULT 0,
  reviews int NOT NULL DEFAULT 0,
  review_correct int NOT NULL DEFAULT 0,
  conf_err_sum real NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);

CREATE TABLE IF NOT EXISTS papers (
  id text PRIMARY KEY,
  doi text,
  title text NOT NULL,
  year int,
  venue text,
  abstract text,
  fetched_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS retrieval_cache (
  qhash bytea PRIMARY KEY,
  paper_ids text[] NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS insights (
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  day date NOT NULL,
  body jsonb NOT NULL,
  PRIMARY KEY (user_id, day)
);
