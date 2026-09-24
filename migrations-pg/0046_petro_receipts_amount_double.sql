-- petro_receipts.amount was created as REAL, which on Postgres is a 4-byte float: above
-- $262,144 it cannot hold cents (262144.37 reads back as 262144.38). Widen it to
-- DOUBLE PRECISION, the 8-byte float every other money column uses. The widening is
-- exact; values already stored keep the float4 value they were saved as.
--
-- src/lib/petroReceipts.ts (ensureReceiptsTable) runs the same ALTER once when it finds
-- the column still typed real; this file mirrors that DDL.

ALTER TABLE petro_receipts ALTER COLUMN amount TYPE DOUBLE PRECISION;
