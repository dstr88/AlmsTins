-- Per-tenant token reclassification (the "Junk drawer" override).
--
-- decision:
--   'include' — false positive; treat as a real holding everywhere
--   'junk'    — confirmed spam/scam; keep it filtered
--   'income'  — a real airdrop; treat as ordinary income at FMV at receipt
--
-- Match scope: a row with a contract is a precise (chain, contract) override;
-- a row with only a symbol matches CEX rows that have no contract address.
--
-- Mirrors the lazy ensure in src/lib/tokenOverrides.ts.

CREATE TABLE IF NOT EXISTS token_overrides (
  id         TEXT PRIMARY KEY,
  tenant_id  TEXT NOT NULL,
  chain      TEXT,
  contract   TEXT,
  symbol     TEXT,
  decision   TEXT NOT NULL,
  note       TEXT,
  created_at TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')),
  updated_at TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'))
);

CREATE UNIQUE INDEX IF NOT EXISTS token_overrides_key
  ON token_overrides (tenant_id, COALESCE(chain,''), COALESCE(contract,''), COALESCE(symbol,''));
