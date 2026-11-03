CREATE TABLE IF NOT EXISTS user_texts (
  id bigserial PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  title text NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS user_texts_user_id_idx ON user_texts (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS user_words (
  user_id bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  word_id text NOT NULL,
  theme_id text NOT NULL,
  en text NOT NULL,
  ru text[] NOT NULL,
  example text NOT NULL DEFAULT '',
  level text NOT NULL CHECK (level IN ('A1', 'A2', 'B1', 'B2', 'C1', 'C2')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, word_id, theme_id)
);

CREATE INDEX IF NOT EXISTS user_words_user_theme_idx ON user_words (user_id, theme_id);

CREATE TABLE IF NOT EXISTS user_text_runs (
  user_id bigint PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  result jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
