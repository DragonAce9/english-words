-- Starter care used to add 24, which never crossed the sad line at 30.
-- Alive pets still under that line on both bars get the calm start.
UPDATE pets
SET hunger = 60, mood = 60
WHERE status = 'alive'
  AND hunger < 30
  AND mood < 30;
