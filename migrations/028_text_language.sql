-- Own texts and their last analysis belong to the language being studied.
-- Existing rows stay English.

ALTER TABLE user_texts ADD COLUMN IF NOT EXISTS language text NOT NULL DEFAULT 'en';
CREATE INDEX IF NOT EXISTS user_texts_user_language_idx ON user_texts (user_id, language, created_at DESC);

ALTER TABLE user_text_runs ADD COLUMN IF NOT EXISTS language text NOT NULL DEFAULT 'en';
ALTER TABLE user_text_runs DROP CONSTRAINT IF EXISTS user_text_runs_pkey;
ALTER TABLE user_text_runs ADD PRIMARY KEY (user_id, language);
