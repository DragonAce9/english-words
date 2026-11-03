ALTER TABLE word_progress
  ADD COLUMN IF NOT EXISTS known_on date,
  ADD COLUMN IF NOT EXISTS control_passed boolean NOT NULL DEFAULT false;
