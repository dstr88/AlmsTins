-- Rename two misleadingly-named columns in tax_pipeline_runs.
--
-- Before this migration the names were inconsistent with the source files:
--   pass3b_fees  — tracks fee classification counts, but fees live in pass3.ts
--                  (not a separate pass3b file)
--   pass3c_defi  — tracks DeFi event counts, but the DeFi code is in pass3b.ts
--
-- After:
--   pass3_fees   — fees come from classifyFeesPass3() in pass3.ts
--   pass3b_defi  — DeFi events come from classifyDeFiPass3b() in pass3b.ts
--
-- SQLite ≥ 3.25.0 (2018) supports RENAME COLUMN.

ALTER TABLE tax_pipeline_runs RENAME COLUMN pass3b_fees TO pass3_fees;
ALTER TABLE tax_pipeline_runs RENAME COLUMN pass3c_defi TO pass3b_defi;
