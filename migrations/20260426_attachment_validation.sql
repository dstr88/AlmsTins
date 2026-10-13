-- Validation result and override note for receipt attachments.
-- Uses IF NOT EXISTS safe pattern; migrate.mjs handles duplicate column errors gracefully.

ALTER TABLE transaction_screenshots ADD COLUMN IF NOT EXISTS validation_json TEXT;
ALTER TABLE transaction_screenshots ADD COLUMN IF NOT EXISTS override_note TEXT;
