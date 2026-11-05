-- INV: step_idx is null on messages saved before a turn was anchored to a step; dont_know defaults to 0 for earlier attempts
ALTER TABLE messages ADD COLUMN step_idx INTEGER CHECK (step_idx IS NULL OR step_idx BETWEEN 0 AND 63);
ALTER TABLE attempts ADD COLUMN dont_know INTEGER NOT NULL DEFAULT 0 CHECK (dont_know IN (0, 1));
