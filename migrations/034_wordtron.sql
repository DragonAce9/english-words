CREATE TABLE IF NOT EXISTS wordtron_games (
  id bigserial PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  language text NOT NULL,
  target_id text NOT NULL,
  status text NOT NULL,
  guesses jsonb NOT NULL DEFAULT '[]'::jsonb,
  hint_pos boolean NOT NULL DEFAULT false,
  hint_theme boolean NOT NULL DEFAULT false,
  hint_letter boolean NOT NULL DEFAULT false,
  hint_translation boolean NOT NULL DEFAULT false,
  closer_uses integer NOT NULL DEFAULT 0,
  attempts integer NOT NULL DEFAULT 0,
  hint_cost integer NOT NULL DEFAULT 0,
  green integer NOT NULL DEFAULT 0,
  yellow integer NOT NULL DEFAULT 0,
  red integer NOT NULL DEFAULT 0,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  CONSTRAINT wordtron_games_status_chk CHECK (status IN ('playing', 'won', 'surrendered'))
);

CREATE UNIQUE INDEX IF NOT EXISTS wordtron_games_one_open
  ON wordtron_games (user_id, language)
  WHERE status = 'playing';

CREATE INDEX IF NOT EXISTS wordtron_games_user_lang_idx
  ON wordtron_games (user_id, language, finished_at);
