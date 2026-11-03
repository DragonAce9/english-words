-- legacy: the invite was already paid in coins. pending: the friend has not finished the first session.
ALTER TABLE referrals
  ADD COLUMN IF NOT EXISTS reward_state text NOT NULL DEFAULT 'legacy',
  ADD COLUMN IF NOT EXISTS claimed_key text,
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz;

ALTER TABLE referrals ALTER COLUMN reward_state SET DEFAULT 'pending';

DO $$
BEGIN
  ALTER TABLE referrals
    ADD CONSTRAINT referrals_reward_state_chk
    CHECK (reward_state IN ('legacy', 'pending', 'ready', 'claimed', 'saved'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS referrals_ready_idx
  ON referrals (inviter_user_id, created_at)
  WHERE reward_state = 'ready';

CREATE TABLE IF NOT EXISTS user_referral_unlocks (
  user_id bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  language text NOT NULL,
  theme_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, language, theme_key)
);
