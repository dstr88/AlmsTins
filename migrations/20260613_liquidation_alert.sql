-- Add opt-in column for liquidation email alerts.
-- When 1, the user receives an email at their alert_email address
-- whenever syncLiquidationsToImportTransactions() detects a new liquidation event.
ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS liquidation_alert INTEGER NOT NULL DEFAULT 0;
