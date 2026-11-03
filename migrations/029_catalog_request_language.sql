-- A film request belongs to the language the user is studying.
-- Older rows stay English.

ALTER TABLE catalog_requests ADD COLUMN IF NOT EXISTS language text NOT NULL DEFAULT 'en';
