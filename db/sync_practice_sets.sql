-- INV: runs on every start, after the migrations, so practice questions generated before 0009 or by an older build after a downgrade get a set too. Only questions in no set are read, so a second run changes nothing.
-- INV: one generate call inserts its questions in one statement, so they share user, topic, style and created_at; that tuple is the set. Lesson checks (lesson_id set) are never grouped.
INSERT INTO practice_sets (user_id, topic_id, style_id, request, created_at)
SELECT q.user_id, q.topic_id, q.style_id, substr(t.name, 1, 120), q.created_at
FROM questions q
JOIN topics t ON t.id = q.topic_id
WHERE q.lesson_id IS NULL
  AND NOT EXISTS (SELECT 1 FROM practice_set_questions m WHERE m.question_id = q.id)
  AND NOT EXISTS (SELECT 1 FROM practice_sets s WHERE s.user_id = q.user_id AND s.topic_id = q.topic_id AND s.style_id IS q.style_id AND s.created_at = q.created_at)
GROUP BY q.user_id, q.topic_id, q.style_id, q.created_at;

INSERT OR IGNORE INTO practice_set_questions (question_id, set_id)
SELECT q.id, (SELECT s.id FROM practice_sets s WHERE s.user_id = q.user_id AND s.topic_id = q.topic_id AND s.style_id IS q.style_id AND s.created_at = q.created_at ORDER BY s.id LIMIT 1)
FROM questions q
WHERE q.lesson_id IS NULL
  AND NOT EXISTS (SELECT 1 FROM practice_set_questions m WHERE m.question_id = q.id);
