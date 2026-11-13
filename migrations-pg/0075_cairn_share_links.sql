-- Download links for a milestone desk project: one labeled link per party (the funder, the contractor,
-- an inspector). Only the SHA-256 of each token is stored. Mirrors the lazy DDL in cairnRegistry.ts.
-- Safe to run more than once.
CREATE TABLE IF NOT EXISTS cairn_share_links (
    id            TEXT NOT NULL PRIMARY KEY,
    token_hash    TEXT NOT NULL UNIQUE,
    from_tenant   TEXT NOT NULL,
    project_id    TEXT NOT NULL,
    label         TEXT,
    expires_at    TEXT NOT NULL,
    revoked_at    TEXT,
    last_used_at  TEXT,
    created_at    TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'))
);
CREATE INDEX IF NOT EXISTS cairn_share_links_project ON cairn_share_links (project_id);
