CREATE TABLE IF NOT EXISTS users (
  id bigserial PRIMARY KEY,
  telegram_user_id bigint NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id bigserial PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES users (id),
  tribute_subscription_id bigint NOT NULL UNIQUE,
  period text NOT NULL CHECK (period IN ('monthly', 'yearly')),
  type text NOT NULL CHECK (type IN ('regular', 'gift', 'trial')),
  expires_at timestamptz NOT NULL,
  cancelled_at timestamptz
);

CREATE INDEX IF NOT EXISTS subscriptions_user_id_idx ON subscriptions (user_id);

CREATE TABLE IF NOT EXISTS word_progress (
  user_id bigint NOT NULL REFERENCES users (id),
  word_id text NOT NULL,
  theme_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('learning', 'known')),
  correct_count integer NOT NULL DEFAULT 0,
  wrong_count integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, word_id)
);

CREATE INDEX IF NOT EXISTS word_progress_user_word_idx ON word_progress (user_id, word_id);
CREATE INDEX IF NOT EXISTS word_progress_user_theme_idx ON word_progress (user_id, theme_id);

CREATE TABLE IF NOT EXISTS tribute_events (
  event_id text PRIMARY KEY,
  event_name text NOT NULL,
  body_hash text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);
