-- Add pass3b_defi column to tax_pipeline_runs for DeFi event classification stats.
-- DeFi classification lives in pass3b.ts (classifyDeFiPass3b).
-- Uses ADD COLUMN so the migration is safe to run on existing tables.
-- Note: originally added as pass3c_defi; renamed to pass3b_defi by
-- 20260412_pipeline_runs_rename_pass3.sql to match the source file name.

ALTER TABLE tax_pipeline_runs ADD COLUMN pass3b_defi INTEGER;
