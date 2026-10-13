-- Almstins Verify — friendly display hint for non-URL payment QRs.
--
-- A PIX/UPI destination stores a HASH as its value (the raw key can be PII), so the
-- dashboard has nothing human-readable to show. display_hint holds the EMV merchant
-- name (tag 59) or the UPI payee name (pn) captured at registration — display only,
-- never used for matching. Mirrors the lazy ALTER in src/lib/verifyRegistry.ts.

ALTER TABLE verify_destinations ADD COLUMN IF NOT EXISTS display_hint TEXT;
