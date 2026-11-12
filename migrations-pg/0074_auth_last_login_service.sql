-- The service and country of each account's last sign-in, for the owner's list of last logins.
-- src/pages/api/auth/[...auth].ts stamps them on every sign-in (in its own write, so last_login
-- still records if these columns are missing); src/pages/admin/index.astro shows them.
-- Safe to run more than once.
ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS last_login_service TEXT;
ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS last_login_country TEXT;
