CREATE TABLE IF NOT EXISTS ai_usage (
  tenant_id  TEXT        NOT NULL,
  month      TEXT        NOT NULL,  -- YYYY-MM
  feature    TEXT        NOT NULL,  -- 'portfolio_chat'
  questions  INTEGER     NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, month, feature)
);
