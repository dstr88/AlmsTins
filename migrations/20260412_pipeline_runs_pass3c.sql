-- Add pass3c_defi column to tax_pipeline_runs for DeFi event classification stats.
-- Uses ADD COLUMN so the migration is safe to run on existing tables.

ALTER TABLE tax_pipeline_runs ADD COLUMN pass3c_defi INTEGER;
