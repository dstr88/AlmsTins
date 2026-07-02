-- FMV provenance for import_transactions.
--
-- price_source records HOW the USD fair-market value was derived:
--   NULL                      → the exchange CSV recorded the USD itself (contemporaneous)
--   'coingecko:range'/'…history' → estimated from a historical index at the receipt time
--   'inferred:stablecoin-peg' → pegged to $1
-- price_asof records the exact timestamp of the index tick actually used (when estimated),
-- so an income line can show "FMV at time of receipt" provenance for a tax preparer.
--
-- Mirrors the lazy ensure in src/lib/priceMissingImportTransactions.ts.

ALTER TABLE import_transactions ADD COLUMN IF NOT EXISTS price_source TEXT;
ALTER TABLE import_transactions ADD COLUMN IF NOT EXISTS price_asof   TEXT;
