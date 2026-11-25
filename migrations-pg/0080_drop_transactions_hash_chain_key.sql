-- transactions_hash_chain_key: a unique rule on (hash, chain), with no account in it, made by hand when
-- production was set up and in no migration until this one. It refused the second side of every swap
-- (one row per hash and chain), so a swap kept one side even after 0079 keyed rows by leg, and it let
-- only one account hold a transaction that two accounts share. Production's was dropped by hand on
-- Nov 25, 2026; this file drops it wherever a copy of the database still has it.
--
-- It may exist as a constraint (which owns its index) or as an index on its own, so both are dropped,
-- each IF EXISTS. Safe to run more than once.
--
-- Also run lazily at runtime, once per process, before the first write (ensureTransactionLegs in
-- src/lib/transactionLegs.ts), which also finds and drops any other unique rule on transactions that
-- covers hash and chain without leg, whatever its name. tests/sync/transactionLegs.test.ts keeps this
-- file and the code identical.
ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_hash_chain_key;
DROP INDEX IF EXISTS transactions_hash_chain_key;
