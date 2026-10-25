-- counterparty_address: the full address on the other side of a chain-synced row, so the address
-- details modal (GET /api/address-history) can show the user's own history with a Bitcoin, Solana
-- or Sui address, as it already does for EVM (transactions.from_address / to_address).
--
-- Written only by the user's own syncs (src/lib/sync/syncBtcAddress.ts, syncSolanaTransactions.ts,
-- syncSuiTransactions.ts), on that tenant's rows, and only where the chain data names one other
-- party; otherwise NULL. In canonicalAddress form (src/lib/wallets-service.ts): base58 exactly as
-- written, bech32 and hex lowercased. Never read across tenants.
--
-- Also run lazily at runtime, once per process (ensureCounterpartyColumns in
-- src/lib/counterpartyColumn.ts); this file is the durable mirror, and tests/sync/counterpartyColumn.test.ts
-- keeps the two identical. Safe to run more than once. Nothing here reads or changes a row.
ALTER TABLE import_transactions ADD COLUMN IF NOT EXISTS counterparty_address TEXT;
ALTER TABLE sui_transactions ADD COLUMN IF NOT EXISTS counterparty_address TEXT;
