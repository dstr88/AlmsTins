-- Agent Vault watcher bookkeeping: the day's pass of the chain read, which is as many calls as it
-- takes. One row per agent wallet: the pass (a UTC date) it was last read in, when its last finished
-- read ended (NULL until one has), how that read ended, and how many transfers it newly recorded in the
-- pass. A call reads the wallets with no finished read in today's pass, least recently read first,
-- so every wallet is read once a day before any is read twice. Not evidence (the ledger, agent_events,
-- is the record): a lost row only means the wallet is read again, and reading it again writes nothing
-- twice.
--
-- Also created lazily at runtime (ensureAgentWalletReadsTable in src/lib/agentVault/syncPass.ts); this
-- file is the durable mirror, and tests/agentics/guards.test.ts keeps the two identical.
-- Safe to run more than once.
CREATE TABLE IF NOT EXISTS agent_wallet_reads (
  tenant_id      TEXT NOT NULL,
  tin_id         TEXT NOT NULL,
  wallet_id      TEXT NOT NULL,
  pass_day       TEXT NOT NULL,
  read_at        TEXT,
  status         TEXT NOT NULL,
  recorded       INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, wallet_id)
);
