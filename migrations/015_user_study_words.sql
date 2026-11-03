CREATE TABLE IF NOT EXISTS user_study_words (
  user_id bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  word_id text NOT NULL,
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, word_id)
);

CREATE INDEX IF NOT EXISTS user_study_words_user_id_idx ON user_study_words (user_id, added_at);
