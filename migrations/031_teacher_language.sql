-- A teacher profile belongs to the language being studied.
-- Existing rows stay English. The old username key blocked the same
-- Telegram account in a second language; the new key is (language, username).

ALTER TABLE teachers ADD COLUMN IF NOT EXISTS language text NOT NULL DEFAULT 'en';

CREATE UNIQUE INDEX IF NOT EXISTS teachers_language_username_lower
  ON teachers (language, lower(telegram_username));

DROP INDEX IF EXISTS teachers_username_lower;
