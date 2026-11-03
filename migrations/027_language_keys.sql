-- 026 briefly kept the old unique keys so a half-applied migration could
-- still satisfy the previous image. Those keys block the same word or theme
-- in a second language, which the new primary keys allow. Drop only those
-- unique indexes. Columns and the older non-unique indexes stay.
-- After this migration the previous API image's ON CONFLICT (user_id, word_id)
-- no longer matches a unique key, so that image must not keep serving.

DROP INDEX IF EXISTS word_progress_user_word_key;
DROP INDEX IF EXISTS user_study_words_user_word_key;
DROP INDEX IF EXISTS user_words_user_word_theme_key;
DROP INDEX IF EXISTS user_studying_user_theme_key;
DROP INDEX IF EXISTS catalog_words_word_key;
