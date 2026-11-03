ALTER TABLE catalog_words DROP CONSTRAINT IF EXISTS catalog_words_source_check;
ALTER TABLE catalog_words
  ADD CONSTRAINT catalog_words_source_check
  CHECK (source IN ('text', 'media', 'search'));
