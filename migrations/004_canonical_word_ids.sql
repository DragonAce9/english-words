ALTER TABLE word_progress
  ALTER COLUMN theme_id DROP NOT NULL;

CREATE TABLE word_progress_canonical AS
SELECT
  user_id,
  CASE
    WHEN word_id = 'daily.wake' THEN 'wake-up'
    WHEN word_id ~ '^[a-z][a-z0-9_]*\.' THEN regexp_replace(word_id, '^[^.]+\.', '')
    ELSE word_id
  END AS word_id,
  CASE WHEN bool_or(status = 'known') THEN 'known' ELSE 'learning' END AS status,
  SUM(correct_count)::int AS correct_count,
  SUM(wrong_count)::int AS wrong_count,
  MAX(updated_at) AS updated_at
FROM word_progress
GROUP BY
  user_id,
  CASE
    WHEN word_id = 'daily.wake' THEN 'wake-up'
    WHEN word_id ~ '^[a-z][a-z0-9_]*\.' THEN regexp_replace(word_id, '^[^.]+\.', '')
    ELSE word_id
  END;

DELETE FROM word_progress;

INSERT INTO word_progress (user_id, word_id, theme_id, status, correct_count, wrong_count, updated_at)
SELECT user_id, word_id, NULL, status, correct_count, wrong_count, updated_at
FROM word_progress_canonical;

DROP TABLE word_progress_canonical;
