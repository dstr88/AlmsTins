-- Verifiable, tamper-evident record exports (Slice B).
-- Two insert-only, tenant-scoped tables. The lazy ensureRecordProofTables()
-- (src/lib/recordProof/store.ts) covers fresh use; this file is the durable
-- prod schema, applied with:
--   node --env-file=.env src/scripts/applyPgSchema.mjs migrations-pg/0004_record_proofs.sql
-- Tenant isolation is app-enforced (every query WHERE tenant_id). Immutable:
-- a correction is a NEW record_id chained via prev_root, never an UPDATE.

CREATE TABLE IF NOT EXISTS record_proofs (
    record_id           TEXT NOT NULL PRIMARY KEY,
    tenant_id           TEXT NOT NULL,
    year                INTEGER NOT NULL,
    record_type         TEXT NOT NULL DEFAULT 'year_summary',
    data_source         TEXT NOT NULL,
    merkle_root         TEXT NOT NULL,
    prev_root           TEXT,
    leaf_count          INTEGER NOT NULL,
    count_short_term    INTEGER NOT NULL DEFAULT 0,
    count_long_term     INTEGER NOT NULL DEFAULT 0,
    count_income        INTEGER NOT NULL DEFAULT 0,
    count_held          INTEGER NOT NULL DEFAULT 0,
    count_unsettled     INTEGER NOT NULL DEFAULT 0,
    tree_algo           TEXT NOT NULL DEFAULT 'sha256-merkle-v1',
    leaf_schema_version INTEGER NOT NULL DEFAULT 1,
    signing_key_id      TEXT,
    signature_hex       TEXT,
    manifest_json       TEXT NOT NULL,
    generated_at        TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
);
CREATE INDEX IF NOT EXISTS record_proofs_tenant_year ON record_proofs (tenant_id, year, generated_at);

CREATE TABLE IF NOT EXISTS record_proof_snapshot (
    record_id   TEXT NOT NULL,
    tenant_id   TEXT NOT NULL,
    leaf_index  INTEGER NOT NULL,
    leaf_json   TEXT NOT NULL,
    leaf_hash   TEXT NOT NULL,
    PRIMARY KEY (record_id, leaf_index)
);
CREATE INDEX IF NOT EXISTS record_proof_snapshot_tenant_record ON record_proof_snapshot (tenant_id, record_id);
