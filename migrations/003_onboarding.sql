ALTER TABLE users
  ADD COLUMN IF NOT EXISTS onboarding_done_at timestamptz;
