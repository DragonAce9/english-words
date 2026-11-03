CREATE TABLE IF NOT EXISTS teachers (
  id text PRIMARY KEY,
  name text NOT NULL,
  telegram_username text NOT NULL,
  telegram_user_id bigint,
  bio text NOT NULL DEFAULT '',
  photo_url text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS teachers_username_lower ON teachers (lower(telegram_username));
