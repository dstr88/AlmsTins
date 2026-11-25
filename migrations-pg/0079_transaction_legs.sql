-- transactions.leg: which movement of a transaction a row is (Wallet Watcher's EVM sync). Until now the
-- table kept one row per account, hash and chain (transactions_tenant_hash_chain_unique, from
-- migrations/0006_tenants.sql), so the second side of a swap overwrote the first, a swap's gas fee could
-- be lost with it, and two identical transfers in one transaction kept one row. A row is now keyed by
-- account, hash, chain, wallet and leg; src/lib/sync/evmSyncRows.ts names the legs.
--
-- The UPDATE fills the leg of every row saved before the column existed, from what the row already
-- holds and in the same words the sync uses, so syncing a wallet again updates those rows instead of
-- adding a second copy. It touches only rows whose leg is still NULL. The new index is built before the
-- old one is dropped; NULLS NOT DISTINCT keeps a row without a wallet from slipping past it.
--
-- Also run lazily at runtime, once per process, before the first write (ensureTransactionLegs in
-- src/lib/transactionLegs.ts); this file is the durable mirror, and tests/sync/transactionLegs.test.ts
-- keeps the two identical. Run it by hand before deploying if the table is large: the index build holds
-- off the table's writers while it runs. Safe to run more than once.
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS leg TEXT;
UPDATE transactions SET leg = CASE
  WHEN metadata_json LIKE '%"isCustomEntry":true%' AND metadata_json LIKE '%"path":"manual"%' THEN 'manual'
  WHEN metadata_json LIKE '%"isCustomEntry":true%' THEN 'custom'
  WHEN metadata_json LIKE '%"source":"scan_token"%' THEN 'token:' || lower(COALESCE(contract_address, '')) || ':' || lower(COALESCE(from_address, '')) || ':' || lower(COALESCE(to_address, '')) || ':' || COALESCE(value, '') || ':0'
  WHEN metadata_json LIKE '%"source":"scan_native"%' OR metadata_json LIKE '%"source":"aave"%' THEN
    CASE WHEN COALESCE(status, '') = 'failed' OR COALESCE(value, '') IN ('', '0') OR lower(COALESCE(from_address, '')) = lower(COALESCE(to_address, ''))
      THEN 'fee'
      ELSE 'native:' || lower(COALESCE(from_address, '')) || ':' || lower(COALESCE(to_address, '')) || ':' || value || ':0'
    END
  ELSE ''
END
WHERE leg IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS transactions_tenant_hash_chain_wallet_leg_unique ON transactions (tenant_id, hash, chain, wallet_id, leg) NULLS NOT DISTINCT;
DROP INDEX IF EXISTS transactions_tenant_hash_chain_unique;
