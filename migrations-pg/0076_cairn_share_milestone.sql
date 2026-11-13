-- A download link can be limited to one milestone (NULL = the whole project). Mirrors the lazy
-- ALTER in cairnRegistry.ts. Safe to run more than once.
ALTER TABLE cairn_share_links ADD COLUMN IF NOT EXISTS milestone_id TEXT;
