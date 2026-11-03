CREATE TABLE IF NOT EXISTS catalog_words (
  word_id text PRIMARY KEY,
  theme_id text NOT NULL,
  en text NOT NULL,
  ru text[] NOT NULL,
  example text NOT NULL DEFAULT '',
  level text NOT NULL CHECK (level IN ('A1', 'A2', 'B1', 'B2', 'C1', 'C2')),
  source text NOT NULL CHECK (source IN ('text', 'media')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS catalog_words_theme_id_idx ON catalog_words (theme_id);

-- Words found in user texts become part of the shared catalog, one row per lemma.
INSERT INTO catalog_words (word_id, theme_id, en, ru, example, level, source, created_at)
SELECT DISTINCT ON (word_id) word_id, theme_id, en, ru, example, level, 'text', created_at
FROM user_words
ORDER BY word_id, created_at
ON CONFLICT (word_id) DO NOTHING;
