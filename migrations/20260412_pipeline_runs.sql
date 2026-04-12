-- Tax pipeline run log
-- Tracks every execution of runTaxPipeline: start time, completion, status,
-- and per-pass statistics. Lets the UI show "last computed X minutes ago"
-- and detect whether the current tax_lots / tax_disposals data came from a
-- successful run or a crashed / partial one.

CREATE TABLE IF NOT EXISTS tax_pipeline_runs (
  id              TEXT    PRIMARY KEY,
  tenant_id       TEXT    NOT NULL,
  started_at      TEXT    NOT NULL,
  completed_at    TEXT,
  status          TEXT    NOT NULL DEFAULT 'running',
  -- 'running' | 'success' | 'failed'
  error_message   TEXT,
  pass1_easy      INTEGER,
  pass2_transfers INTEGER,
  pass2b_loans    INTEGER,
  pass3_income    INTEGER,
  pass3_fees      INTEGER,
  pass4_lots      INTEGER,
  pass4_disposals INTEGER,
  pass5_review    INTEGER,
  total_classified INTEGER,
  total_unknown   INTEGER
);

CREATE INDEX IF NOT EXISTS idx_pipeline_runs_tenant
  ON tax_pipeline_runs (tenant_id, started_at DESC);
