-- wallet_identity: the label and owner label for each wallet, keyed by the wallet key from
-- src/lib/walletKey.ts (cex:{source}:{account_id} for exchange accounts, {chain}:{address}
-- for on-chain wallets), unique per tenant.
--
-- Also created lazily at runtime (ensureWalletIdentityTable in src/lib/walletIdentity.ts);
-- this file is the durable mirror. Safe to run more than once. Deleted with the account
-- (src/lib/accountDeleteTables.ts).
CREATE TABLE IF NOT EXISTS wallet_identity (
  tenant_id   TEXT NOT NULL,
  wallet_key  TEXT NOT NULL,
  label       TEXT,
  owner_label TEXT,
  updated_at  TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')),
  UNIQUE (tenant_id, wallet_key)
);
