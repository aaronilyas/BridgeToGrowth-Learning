-- INV: runs on every start, after the migrations, because v0.1.1 cannot run anything of ours when it adds steps or chat. Only rows no lesson turn points at are read, so a second run changes nothing.
-- INV: never writes to messages, lesson_steps or lessons. A conversation row is added only for a lesson that has steps and none yet, and v0.1.1's own upsert accepts it.
-- INV: rows new to one run keep the order the learner read them in: each step, then its chat, then chat tied to no opened step. Later runs append, so work done in v0.1.1 lands after what this build already holds.
INSERT INTO conversations (user_id, lesson_id)
SELECT l.user_id, l.id FROM lessons l
WHERE EXISTS (SELECT 1 FROM lesson_steps s WHERE s.lesson_id = l.id)
  AND NOT EXISTS (SELECT 1 FROM conversations c WHERE c.lesson_id = l.id);

INSERT INTO lesson_turns (conv_id, role, content, citations, topic_idx, check_id, finishes, created_at, legacy_message_id, legacy_step_idx)
WITH step AS (
  SELECT c.id AS conv_id, s.idx, q.id AS check_id,
    coalesce(q.created_at, l.created_at) AS created_at,
    coalesce(json_extract(s.content, '$.title'), '') AS title,
    coalesce(json_extract(s.content, '$.explanationMd'), '') AS body,
    coalesce(json_extract(s.content, '$.keyIdea'), '') AS key_idea,
    coalesce(json_extract(s.content, '$.example'), '') AS example,
    coalesce(json_extract(s.content, '$.citations'), '[]') AS citations
  FROM lesson_steps s
  JOIN lessons l ON l.id = s.lesson_id
  JOIN conversations c ON c.lesson_id = s.lesson_id
  LEFT JOIN questions q ON q.id = json_extract(s.content, '$.questionId')
  WHERE NOT EXISTS (SELECT 1 FROM lesson_turns t WHERE t.conv_id = c.id AND t.legacy_step_idx = s.idx)
), located AS (
  SELECT step.*, instr(replace(body, char(10), ' '), '. ') AS dot, instr(body, char(10)) AS nl FROM step
), cleaned AS (
  -- INV: older lessons wrote a prerequisites line at the top of the first step; the page lists unmet prerequisites itself
  SELECT located.*, CASE WHEN idx = 0 AND body LIKE '**Prerequisites:**%' AND dot > 0 AND (nl = 0 OR dot < nl) THEN ltrim(substr(body, dot + 2), ' ' || char(10)) ELSE body END AS prose FROM located
)
SELECT conv_id, role, content, citations, topic_idx, check_id, 0, created_at, legacy_message_id, legacy_step_idx FROM (
  SELECT conv_id, 'assistant' AS role,
    CASE WHEN title <> '' THEN '### ' || title || char(10, 10) ELSE '' END || prose
      || CASE WHEN key_idea = '' THEN '' WHEN key_idea LIKE '**%' THEN char(10, 10) || key_idea ELSE char(10, 10) || '**Key idea:** ' || key_idea END
      || CASE WHEN example = '' THEN '' ELSE char(10, 10) || '**Worked example**' || char(10, 10) || example END AS content,
    citations, idx AS topic_idx, check_id, created_at, NULL AS legacy_message_id, idx AS legacy_step_idx,
    idx AS sort_group, 0 AS sort_kind, 0 AS sort_id
  FROM cleaned
  UNION ALL
  SELECT m.conv_id, m.role, m.content, m.citations, o.idx, NULL, m.created_at, m.id, NULL, coalesce(o.idx, 1000), 1, m.id
  FROM messages m
  JOIN conversations c ON c.id = m.conv_id
  LEFT JOIN lesson_steps o ON o.lesson_id = c.lesson_id AND o.idx = m.step_idx
  WHERE NOT EXISTS (SELECT 1 FROM lesson_turns t WHERE t.legacy_message_id = m.id)
) ORDER BY conv_id, sort_group, sort_kind, sort_id;

-- INV: a v0.1.1 lesson is finished once every planned step has an attempted check, and that can become true after the step was imported. A tutor-led lesson is closed by the tutor, so a turn projected to a step (it has a legacy message) is left alone.
UPDATE lesson_turns SET finishes = 1
WHERE finishes = 0 AND legacy_step_idx IS NOT NULL AND legacy_message_id IS NULL AND id IN (
  SELECT t.id FROM lesson_turns t
  JOIN conversations c ON c.id = t.conv_id
  JOIN lessons l ON l.id = c.lesson_id
  WHERE coalesce(json_array_length(l.plan, '$.steps'), 0) > 0
    AND t.legacy_step_idx = json_array_length(l.plan, '$.steps') - 1
    AND (SELECT count(*) FROM lesson_steps o WHERE o.lesson_id = l.id AND o.idx < json_array_length(l.plan, '$.steps')
      AND EXISTS (SELECT 1 FROM attempts a WHERE a.user_id = l.user_id AND a.question_id = json_extract(o.content, '$.questionId'))) >= json_array_length(l.plan, '$.steps')
);
