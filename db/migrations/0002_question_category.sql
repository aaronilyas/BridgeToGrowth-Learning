ALTER TABLE questions ADD COLUMN IF NOT EXISTS category text CHECK (category IN ('terminology','conceptual','mcq','free'));
