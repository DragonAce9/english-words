CREATE TABLE IF NOT EXISTS user_media (
  id bigserial PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('movie', 'episode')),
  title text NOT NULL,
  subtitle text NOT NULL DEFAULT '',
  tmdb_id integer,
  tmdb_show_id integer,
  season integer,
  episode integer,
  year integer,
  poster_url text,
  body text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS user_media_user_id_idx ON user_media (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS user_media_words (
  media_id bigint NOT NULL REFERENCES user_media (id) ON DELETE CASCADE,
  word_id text NOT NULL,
  en text NOT NULL,
  ru text[] NOT NULL,
  example text NOT NULL DEFAULT '',
  level text NOT NULL CHECK (level IN ('A1', 'A2', 'B1', 'B2', 'C1', 'C2')),
  PRIMARY KEY (media_id, word_id)
);
