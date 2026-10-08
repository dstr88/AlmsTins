-- import_transactions.price_source: how the price backfill derived a row's USD value
-- ('inferred:stablecoin-peg', or a historical-price source). NULL means the imported
-- file carried the USD value itself.
--
-- src/lib/priceMissingImportTransactions.ts writes this column and adds it lazily
-- (ALTER TABLE ... ADD COLUMN IF NOT EXISTS) before its first UPDATE; this file mirrors
-- that DDL. Without the column every backfill UPDATE failed and nothing was priced.

ALTER TABLE import_transactions ADD COLUMN IF NOT EXISTS price_source TEXT;
