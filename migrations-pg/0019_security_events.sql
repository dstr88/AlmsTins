-- Security event log: injection attempts, anomalous usage, auth anomalies.
CREATE TABLE IF NOT EXISTS security_events (
  id          BIGSERIAL PRIMARY KEY,
  tenant_id   TEXT        NOT NULL,
  event_type  TEXT        NOT NULL,  -- 'injection_attempt', 'rate_probe', etc.
  payload     TEXT,                  -- JSON blob: question, patterns matched, etc.
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS security_events_tenant_idx ON security_events (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS security_events_type_idx   ON security_events (event_type, created_at DESC);
