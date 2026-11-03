ALTER TABLE users
  ADD COLUMN IF NOT EXISTS referral_code text;

CREATE UNIQUE INDEX IF NOT EXISTS users_referral_code_uidx ON users (referral_code);

CREATE TABLE IF NOT EXISTS referrals (
  invited_user_id bigint PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  inviter_user_id bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT referrals_not_self CHECK (invited_user_id <> inviter_user_id)
);

CREATE INDEX IF NOT EXISTS referrals_inviter_user_id_idx ON referrals (inviter_user_id);
