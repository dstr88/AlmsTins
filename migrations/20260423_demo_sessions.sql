-- Demo session counter
-- One row per demo start. Never deleted — gives a running total over time.
CREATE TABLE IF NOT EXISTS demo_sessions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  user_agent  TEXT,
  referrer    TEXT
);
