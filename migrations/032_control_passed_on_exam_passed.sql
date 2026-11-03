ALTER TABLE word_progress
  ADD COLUMN IF NOT EXISTS control_passed_on date,
  ADD COLUMN IF NOT EXISTS exam_passed boolean NOT NULL DEFAULT false;
