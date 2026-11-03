ALTER TABLE word_progress
  ADD COLUMN IF NOT EXISTS rewarded boolean NOT NULL DEFAULT false;

-- A word that is already known has had its chance at Moti coins.
UPDATE word_progress
SET rewarded = true
WHERE status = 'known' AND rewarded = false;
