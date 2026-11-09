-- INV: additive only. v0.1.1 keeps reading messages, lesson_steps, lessons.plan and users.settings exactly as it wrote them, so this build's conversation lives in its own table.
-- INV: legacy_message_id and legacy_step_idx name the v0.1.1 row a turn came from or was projected to; each is unique, which is what makes the import in db/sync_legacy_lessons.sql idempotent.
CREATE TABLE lesson_turns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conv_id TEXT NOT NULL REFERENCES conversations ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL CHECK (length(content) <= 20000),
  citations TEXT NOT NULL DEFAULT '[]',
  topic_idx INTEGER CHECK (topic_idx IS NULL OR topic_idx BETWEEN 0 AND 63),
  check_id TEXT REFERENCES questions ON DELETE SET NULL,
  finishes INTEGER NOT NULL DEFAULT 0 CHECK (finishes IN (0, 1)),
  created_at INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  legacy_message_id INTEGER,
  legacy_step_idx INTEGER
) STRICT;
CREATE INDEX lesson_turns_conv_idx ON lesson_turns (conv_id, id);
CREATE INDEX lesson_turns_check_idx ON lesson_turns (check_id) WHERE check_id IS NOT NULL;
CREATE UNIQUE INDEX lesson_turns_message_idx ON lesson_turns (legacy_message_id) WHERE legacy_message_id IS NOT NULL;
CREATE UNIQUE INDEX lesson_turns_step_idx ON lesson_turns (conv_id, legacy_step_idx) WHERE legacy_step_idx IS NOT NULL;

-- INV: one row per question Practice has put in front of the learner as new. day is the local calendar day it was last served. A served question with an attempt on that day has used one of that day's new cards.
CREATE TABLE new_card_intros (
  question_id TEXT PRIMARY KEY REFERENCES questions ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users ON DELETE CASCADE,
  day TEXT NOT NULL
) STRICT;
CREATE INDEX new_card_intros_user_day_idx ON new_card_intros (user_id, day);
