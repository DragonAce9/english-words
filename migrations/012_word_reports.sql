CREATE TABLE IF NOT EXISTS word_reports (
  id bigserial PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  telegram_user_id bigint NOT NULL,
  word_id text NOT NULL,
  en text NOT NULL,
  ru text[] NOT NULL,
  theme_id text NOT NULL,
  theme_title text NOT NULL,
  example text NOT NULL DEFAULT '',
  reason text NOT NULL CHECK (reason IN ('translation', 'category', 'sense', 'example')),
  comment text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'rejected', 'applied', 'skipped', 'failed')),
  ai_note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz
);

CREATE INDEX IF NOT EXISTS word_reports_pending_idx ON word_reports (word_id, status);

CREATE TABLE IF NOT EXISTS word_fixes (
  word_id text PRIMARY KEY,
  ru text[],
  from_theme_id text,
  to_theme_id text,
  note text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);
