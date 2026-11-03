-- Additive language columns. Existing rows stay on English.
-- Primary keys grow to include language so the same word id can be stored
-- once per studied language. Columns are not dropped or renamed.
-- Non-unique indexes on the old columns stay. The old unique key cannot
-- remain: it blocks a second language. See 027.

ALTER TABLE users ADD COLUMN IF NOT EXISTS language text NOT NULL DEFAULT 'en';
ALTER TABLE users ADD COLUMN IF NOT EXISTS language_chosen boolean NOT NULL DEFAULT false;

ALTER TABLE word_progress ADD COLUMN IF NOT EXISTS language text NOT NULL DEFAULT 'en';
ALTER TABLE word_progress DROP CONSTRAINT IF EXISTS word_progress_pkey;
ALTER TABLE word_progress ADD PRIMARY KEY (user_id, language, word_id);

ALTER TABLE user_study_words ADD COLUMN IF NOT EXISTS language text NOT NULL DEFAULT 'en';
ALTER TABLE user_study_words DROP CONSTRAINT IF EXISTS user_study_words_pkey;
ALTER TABLE user_study_words ADD PRIMARY KEY (user_id, language, word_id);

ALTER TABLE user_words ADD COLUMN IF NOT EXISTS language text NOT NULL DEFAULT 'en';
ALTER TABLE user_words DROP CONSTRAINT IF EXISTS user_words_pkey;
ALTER TABLE user_words ADD PRIMARY KEY (user_id, language, word_id, theme_id);

ALTER TABLE user_studying ADD COLUMN IF NOT EXISTS language text NOT NULL DEFAULT 'en';
ALTER TABLE user_studying DROP CONSTRAINT IF EXISTS user_studying_pkey;
ALTER TABLE user_studying ADD PRIMARY KEY (user_id, language, theme_id);

ALTER TABLE catalog_words ADD COLUMN IF NOT EXISTS language text NOT NULL DEFAULT 'en';
ALTER TABLE catalog_words DROP CONSTRAINT IF EXISTS catalog_words_pkey;
ALTER TABLE catalog_words ADD PRIMARY KEY (language, word_id);

CREATE TABLE IF NOT EXISTS user_free_media (
  user_id bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  language text NOT NULL DEFAULT 'en',
  free_media_id text NOT NULL,
  PRIMARY KEY (user_id, language)
);

INSERT INTO user_free_media (user_id, language, free_media_id)
SELECT id, 'en', free_media_id
FROM users
WHERE free_media_id IS NOT NULL
ON CONFLICT (user_id, language) DO NOTHING;

CREATE INDEX IF NOT EXISTS word_progress_user_language_idx ON word_progress (user_id, language);
CREATE INDEX IF NOT EXISTS user_studying_user_language_idx ON user_studying (user_id, language);
CREATE INDEX IF NOT EXISTS user_study_words_user_language_idx ON user_study_words (user_id, language);
CREATE INDEX IF NOT EXISTS user_words_user_language_idx ON user_words (user_id, language);
