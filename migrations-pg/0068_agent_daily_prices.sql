-- Agent Vault daily prices (Nov 5, 2026): one row per coin and UTC day, the coin's USD price at noon
-- UTC of that day, or `none` once it was looked for past the retry window and not found. A transfer
-- whose price was not available when it was recorded (a morning transfer, before the day's noon price
-- exists) carries a pending mark in the ledger, and its USD value is worked out from this table when it
-- is read. One lookup and one row per coin and day, however many transfers share them.
--
-- Public market data only: no account column, and nothing here is about an account.
-- Also created lazily at runtime (ensureDailyPricesTable in src/lib/agentVault/dailyPrices.ts); this
-- file is the durable mirror, and tests/agentics/guards.test.ts keeps the two identical.
-- Safe to run more than once.
CREATE TABLE IF NOT EXISTS agent_daily_prices (
  coin_id    TEXT NOT NULL,
  day        TEXT NOT NULL,
  status     TEXT NOT NULL CHECK (status IN ('priced', 'none')),
  unit_usd   DOUBLE PRECISION,
  fetched_at TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')),
  PRIMARY KEY (coin_id, day)
);
