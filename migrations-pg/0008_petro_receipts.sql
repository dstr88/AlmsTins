-- Receipt registry for PetroTins.
--
-- A standalone, tenant-scoped log of receipts the user keeps for their tax
-- preparer: an amount, what it was for, an optional category, and a photo of
-- the receipt (PNG/JPG/GIF/WEBP/PDF stored base64 in `data`). Nothing auto-
-- deletes these rows; the durable "keep it for seven years" copy is the ZIP+CSV
-- export, which lives outside the app.
--
-- Scoped by tenant_id like every other table — no cross-tenant read path.
-- Also self-created lazily by src/lib/petroReceipts.ts (ensureReceiptsTable),
-- so the feature works on deploy even before this migration is applied.

CREATE TABLE IF NOT EXISTS petro_receipts (
  id           TEXT NOT NULL PRIMARY KEY,
  tenant_id    TEXT NOT NULL,
  receipt_date TEXT NOT NULL,
  amount       REAL NOT NULL DEFAULT 0,
  description  TEXT,
  category     TEXT,
  filename     TEXT,
  mime_type    TEXT,
  data         TEXT,
  file_size    INTEGER,
  created_at   TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'))
);

CREATE INDEX IF NOT EXISTS idx_petro_receipts_tenant
  ON petro_receipts (tenant_id, receipt_date DESC, created_at DESC);
