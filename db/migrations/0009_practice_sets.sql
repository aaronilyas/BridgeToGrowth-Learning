-- INV: additive only. Older builds never read these tables, and deleting a question there cascades its membership row away here.
-- INV: a practice set is one generated batch of questions. request is the topic text the learner typed, kept so the set can be regenerated.
CREATE TABLE practice_sets (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', (random() & 3) + 1, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))),
  user_id TEXT NOT NULL REFERENCES users ON DELETE CASCADE,
  topic_id TEXT NOT NULL REFERENCES topics ON DELETE CASCADE,
  style_id TEXT REFERENCES styles ON DELETE SET NULL,
  request TEXT NOT NULL CHECK (length(request) BETWEEN 1 AND 120),
  created_at INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER))
) STRICT;
CREATE INDEX practice_sets_user_idx ON practice_sets (user_id, created_at);

-- INV: a question belongs to at most one set; lesson checks belong to none
CREATE TABLE practice_set_questions (
  question_id TEXT PRIMARY KEY REFERENCES questions ON DELETE CASCADE,
  set_id TEXT NOT NULL REFERENCES practice_sets ON DELETE CASCADE
) STRICT;
CREATE INDEX practice_set_questions_set_idx ON practice_set_questions (set_id);
