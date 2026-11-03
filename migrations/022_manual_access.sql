CREATE TABLE IF NOT EXISTS manual_access (
  id bigserial PRIMARY KEY,
  username text NOT NULL UNIQUE,
  period text NOT NULL CHECK (period IN ('monthly', 'yearly')),
  created_at timestamptz NOT NULL DEFAULT now(),
  applied_user_id bigint,
  applied_at timestamptz
);

INSERT INTO manual_access (username, period)
VALUES ('your_telegram_username', 'monthly')
ON CONFLICT (username) DO NOTHING;
