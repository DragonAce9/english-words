ALTER TABLE wordtron_games ADD COLUMN IF NOT EXISTS bots smallint NOT NULL DEFAULT 0;

DO $$
BEGIN
  ALTER TABLE wordtron_games
    ADD CONSTRAINT wordtron_games_bots_chk CHECK (bots IN (0, 2, 3));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
