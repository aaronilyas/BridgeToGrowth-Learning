-- INV: runs only on a database the retired 0006_lesson_topics.sql already rewrote (scripts/migrate.ts checks the ledger). 0006 dropped lesson_steps and folded steps into messages, so v0.1.1's form is rebuilt here from what survived.
-- INV: every message keeps its text and order. A step comes back as the first check asked on its topic, with the original explanation left in the conversation below it.
INSERT INTO lesson_turns (id, conv_id, role, content, citations, topic_idx, check_id, finishes, created_at, legacy_message_id)
SELECT id, conv_id, role, content, citations, topic_idx, check_id, finishes, created_at, id FROM messages ORDER BY id;

UPDATE lessons SET plan = json_remove(json_set(plan, '$.steps', json(plan -> '$.outline')), '$.outline') WHERE json_type(plan, '$.outline') = 'array';

-- INV: v0.1.1 parses settings strictly and resets everything on an unknown key
UPDATE users SET settings = json_remove(json_set(settings, '$.bite.stepsPerLesson', json_extract(settings, '$.bite.topicsPerLesson')), '$.bite.topicsPerLesson') WHERE json_type(settings, '$.bite.topicsPerLesson') IS NOT NULL;
UPDATE users SET settings = json_remove(json_set(settings, '$.bite.maxWordsPerStep', json_extract(settings, '$.bite.maxWordsPerTurn')), '$.bite.maxWordsPerTurn') WHERE json_type(settings, '$.bite.maxWordsPerTurn') IS NOT NULL;

CREATE TABLE lesson_steps (
  lesson_id TEXT NOT NULL REFERENCES lessons ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  content TEXT NOT NULL,
  PRIMARY KEY (lesson_id, idx)
) STRICT;

INSERT INTO lesson_steps (lesson_id, idx, content)
SELECT c.lesson_id, t.topic_idx, json_object(
    'title', coalesce(json_extract(l.plan, '$.steps[' || t.topic_idx || '].title'), ''),
    'explanationMd', 'The tutor asked this check in the conversation below.',
    'keyIdea', coalesce(json_extract(l.plan, '$.steps[' || t.topic_idx || '].summary'), ''),
    'example', NULL,
    'citations', json('[]'),
    'questionId', q.id)
FROM lesson_turns t
JOIN conversations c ON c.id = t.conv_id
JOIN lessons l ON l.id = c.lesson_id
JOIN questions q ON q.id = t.check_id
WHERE t.role = 'assistant' AND t.topic_idx IS NOT NULL AND t.topic_idx < coalesce(json_array_length(l.plan, '$.steps'), 0)
  AND t.id = (SELECT min(o.id) FROM lesson_turns o WHERE o.conv_id = t.conv_id AND o.topic_idx = t.topic_idx AND o.check_id IS NOT NULL);

UPDATE lesson_turns SET legacy_step_idx = topic_idx
WHERE check_id IS NOT NULL AND EXISTS (
  SELECT 1 FROM lesson_steps s JOIN conversations c ON c.lesson_id = s.lesson_id
  WHERE c.id = lesson_turns.conv_id AND s.idx = lesson_turns.topic_idx AND json_extract(s.content, '$.questionId') = lesson_turns.check_id
);

CREATE TABLE messages_v011 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conv_id TEXT NOT NULL REFERENCES conversations ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL CHECK (length(content) <= 20000),
  citations TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  step_idx INTEGER CHECK (step_idx IS NULL OR step_idx BETWEEN 0 AND 63)
) STRICT;

INSERT INTO messages_v011 (id, conv_id, role, content, citations, created_at, step_idx)
SELECT t.id, t.conv_id, t.role,
  CASE WHEN q.id IS NOT NULL AND t.legacy_step_idx IS NULL
    THEN substr(t.content || char(10, 10) || '**Check from the tutor (answer it in Practice):** ' || q.stem, 1, 20000)
    ELSE t.content END,
  t.citations, t.created_at, t.topic_idx
FROM lesson_turns t LEFT JOIN questions q ON q.id = t.check_id
ORDER BY t.id;

DROP TABLE messages;
ALTER TABLE messages_v011 RENAME TO messages;
CREATE INDEX messages_conv_idx ON messages (conv_id, id);
