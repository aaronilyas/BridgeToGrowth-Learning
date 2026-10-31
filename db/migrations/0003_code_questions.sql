ALTER TABLE questions DROP CONSTRAINT IF EXISTS questions_kind_check;
ALTER TABLE questions ADD CONSTRAINT questions_kind_check CHECK (kind IN ('mcq','free','code'));
ALTER TABLE questions ADD COLUMN IF NOT EXISTS code_spec jsonb;
ALTER TABLE questions DROP CONSTRAINT IF EXISTS questions_code_spec_check;
ALTER TABLE questions ADD CONSTRAINT questions_code_spec_check CHECK ((kind = 'code') = (code_spec IS NOT NULL));
