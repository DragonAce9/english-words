CREATE TABLE IF NOT EXISTS user_studying (
  user_id bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  theme_id text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, theme_id)
);

CREATE INDEX IF NOT EXISTS user_studying_user_id_idx ON user_studying (user_id, started_at DESC);
