-- Sui transaction history (separate from EVM transactions table to avoid hash uniqueness conflicts)
CREATE TABLE IF NOT EXISTS sui_transactions (
  id          TEXT PRIMARY KEY,      -- digest + ':' + safe_coin_type
  wallet_id   TEXT NOT NULL,
  tenant_id   TEXT NOT NULL,
  digest      TEXT NOT NULL,         -- Sui transaction digest (base58)
  coin_type   TEXT NOT NULL,         -- e.g. "0x2::sui::SUI"
  symbol      TEXT NOT NULL,         -- human-readable symbol e.g. "SUI"
  amount      TEXT NOT NULL,         -- signed raw amount (negative = out, positive = in)
  decimals    INTEGER NOT NULL DEFAULT 9,
  timestamp   TEXT NOT NULL,         -- ISO-8601
  fee_mist    TEXT,                  -- gas fee in MIST (smallest SUI unit)
  status      TEXT,                  -- "success" | "failure"
  note        TEXT,
  category    TEXT,
  created_at  TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);

CREATE INDEX IF NOT EXISTS sui_tx_wallet_idx
  ON sui_transactions(wallet_id, tenant_id);

CREATE UNIQUE INDEX IF NOT EXISTS sui_tx_tenant_digest_coin_unique
  ON sui_transactions(tenant_id, digest, coin_type);
