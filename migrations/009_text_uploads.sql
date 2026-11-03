-- Durable log of every new user text, so the paid "N texts per month" limit
-- survives deletion of the text itself.
CREATE TABLE IF NOT EXISTS user_text_uploads (
  id bigserial PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  text_id bigint,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS user_text_uploads_user_idx ON user_text_uploads (user_id, created_at DESC);

-- Backfill from texts that already exist so the window starts honest.
INSERT INTO user_text_uploads (user_id, text_id, created_at)
SELECT user_id, id, created_at FROM user_texts
WHERE NOT EXISTS (SELECT 1 FROM user_text_uploads);
