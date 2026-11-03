ALTER TABLE word_progress
  ADD COLUMN IF NOT EXISTS examined boolean NOT NULL DEFAULT false;
