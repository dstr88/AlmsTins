ALTER TABLE auth_accounts ADD COLUMN id TEXT;

UPDATE auth_accounts
SET id = lower(hex(randomblob(16)))
WHERE id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS auth_accounts_id_idx
  ON auth_accounts(id);
