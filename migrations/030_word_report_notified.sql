-- Set only after Telegram accepts the complaint.
-- A pending row with notified_at NULL can be sent again; the app must not
-- tell the learner it was delivered when sendMessage failed.

ALTER TABLE word_reports ADD COLUMN IF NOT EXISTS notified_at timestamptz;
