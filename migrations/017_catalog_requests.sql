CREATE TABLE IF NOT EXISTS catalog_requests (
  id bigserial PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  telegram_user_id bigint NOT NULL,
  kind text NOT NULL CHECK (kind IN ('movie', 'series')),
  title text NOT NULL CHECK (length(btrim(title)) > 0),
  comment text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS catalog_requests_user_idx ON catalog_requests (user_id, created_at DESC);
