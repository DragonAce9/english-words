CREATE TABLE IF NOT EXISTS teacher_applications (
  id bigserial PRIMARY KEY,
  telegram_user_id bigint NOT NULL,
  telegram_username text NOT NULL,
  name text NOT NULL,
  bio text NOT NULL,
  photo_file_id text,
  photo_url text,
  languages text[] NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz
);

CREATE INDEX IF NOT EXISTS teacher_applications_user_idx
  ON teacher_applications (telegram_user_id, created_at DESC);
