-- New pets used to start at 0/0, which is below the "sad" line.
-- Untouched alive pets (never fed and never played) get the same calm start.
ALTER TABLE pets ALTER COLUMN hunger SET DEFAULT 60;
ALTER TABLE pets ALTER COLUMN mood SET DEFAULT 60;

UPDATE pets
SET hunger = 60, mood = 60
WHERE status = 'alive'
  AND hunger = 0
  AND mood = 0;
