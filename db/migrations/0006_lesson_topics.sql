-- INV: a lesson is one conversation over a topic outline. Each generated step becomes a tutor message in the position the learner saw it, followed by the chat anchored to it.
-- INV: messages that belonged to no opened step keep their old place after the last step
-- INV: a step with its check becomes a message with check_id; the attempts, cards and mastery on that question are untouched
INSERT INTO conversations (user_id, lesson_id)
SELECT l.user_id, l.id FROM lessons l
WHERE EXISTS (SELECT 1 FROM lesson_steps s WHERE s.lesson_id = l.id)
  AND NOT EXISTS (SELECT 1 FROM conversations c WHERE c.lesson_id = l.id);

CREATE TABLE messages_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conv_id TEXT NOT NULL REFERENCES conversations ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL CHECK (length(content) <= 20000),
  citations TEXT NOT NULL DEFAULT '[]',
  topic_idx INTEGER CHECK (topic_idx IS NULL OR topic_idx BETWEEN 0 AND 63),
  check_id TEXT REFERENCES questions ON DELETE SET NULL,
  finishes INTEGER NOT NULL DEFAULT 0 CHECK (finishes IN (0, 1)),
  created_at INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER))
) STRICT;

INSERT INTO messages_new (conv_id, role, content, citations, topic_idx, check_id, finishes, created_at)
WITH step AS (
  SELECT s.lesson_id, s.idx, c.id AS conv_id, q.id AS check_id,
    coalesce(q.created_at, l.created_at) AS created_at,
    coalesce(json_extract(s.content, '$.title'), '') AS title,
    coalesce(json_extract(s.content, '$.explanationMd'), '') AS body,
    coalesce(json_extract(s.content, '$.keyIdea'), '') AS key_idea,
    coalesce(json_extract(s.content, '$.example'), '') AS example,
    coalesce(json_extract(s.content, '$.citations'), '[]') AS citations,
    coalesce(json_array_length(l.plan, '$.steps'), 0) AS planned,
    (SELECT count(*) FROM lesson_steps o WHERE o.lesson_id = s.lesson_id AND o.idx < coalesce(json_array_length(l.plan, '$.steps'), 0) AND EXISTS (SELECT 1 FROM attempts a WHERE a.user_id = l.user_id AND a.question_id = json_extract(o.content, '$.questionId'))) AS attempted
  FROM lesson_steps s
  JOIN lessons l ON l.id = s.lesson_id
  JOIN conversations c ON c.lesson_id = s.lesson_id
  LEFT JOIN questions q ON q.id = json_extract(s.content, '$.questionId')
), located AS (
  SELECT step.*, instr(replace(body, char(10), ' '), '. ') AS dot, instr(body, char(10)) AS nl FROM step
), cleaned AS (
  -- INV: older lessons wrote a prerequisites line at the top of the first step; the page lists unmet prerequisites itself
  SELECT located.*, CASE WHEN idx = 0 AND body LIKE '**Prerequisites:**%' AND dot > 0 AND (nl = 0 OR dot < nl) THEN ltrim(substr(body, dot + 2), ' ' || char(10)) ELSE body END AS prose FROM located
)
SELECT conv_id, role, content, citations, topic_idx, check_id, finishes, created_at FROM (
  SELECT conv_id, 'assistant' AS role,
    CASE WHEN title <> '' THEN '### ' || title || char(10, 10) ELSE '' END || prose
      || CASE WHEN key_idea = '' THEN '' WHEN key_idea LIKE '**%' THEN char(10, 10) || key_idea ELSE char(10, 10) || '**Key idea:** ' || key_idea END
      || CASE WHEN example = '' THEN '' ELSE char(10, 10) || '**Worked example**' || char(10, 10) || example END AS content,
    citations, idx AS topic_idx, check_id,
    CASE WHEN planned > 0 AND idx = planned - 1 AND attempted >= planned THEN 1 ELSE 0 END AS finishes,
    created_at, idx AS sort_group, 0 AS sort_kind, 0 AS sort_id
  FROM cleaned
  UNION ALL
  SELECT m.conv_id, m.role, m.content, m.citations, o.idx, NULL, 0, m.created_at, coalesce(o.idx, 1000), 1, m.id
  FROM messages m
  JOIN conversations c ON c.id = m.conv_id
  LEFT JOIN lesson_steps o ON o.lesson_id = c.lesson_id AND o.idx = m.step_idx
) ORDER BY conv_id, sort_group, sort_kind, sort_id;

DROP TABLE messages;
ALTER TABLE messages_new RENAME TO messages;
CREATE INDEX messages_conv_idx ON messages (conv_id, id);
CREATE INDEX messages_check_idx ON messages (check_id) WHERE check_id IS NOT NULL;
DROP TABLE lesson_steps;

UPDATE lessons SET plan = json_remove(json_set(plan, '$.outline', json(plan -> '$.steps')), '$.steps') WHERE json_type(plan, '$.steps') = 'array';

-- INV: Settings is a strict schema and falls back to full defaults on an unknown key, so renamed keys move here
UPDATE users SET settings = json_remove(json_set(settings, '$.bite.topicsPerLesson', json_extract(settings, '$.bite.stepsPerLesson')), '$.bite.stepsPerLesson') WHERE json_type(settings, '$.bite.stepsPerLesson') IS NOT NULL;
UPDATE users SET settings = json_remove(json_set(settings, '$.bite.maxWordsPerTurn', json_extract(settings, '$.bite.maxWordsPerStep')), '$.bite.maxWordsPerStep') WHERE json_type(settings, '$.bite.maxWordsPerStep') IS NOT NULL;
