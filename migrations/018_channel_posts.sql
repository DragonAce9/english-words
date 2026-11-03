CREATE TABLE IF NOT EXISTS channel_posts (
  id text PRIMARY KEY,
  posted_at timestamptz NOT NULL DEFAULT now()
);
