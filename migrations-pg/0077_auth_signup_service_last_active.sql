-- Two facts about an account, for the owner's admin page (src/pages/admin/index.astro):
--
--   signup_service  The product the account signed up for (wallet-watcher, verify, receivables,
--                   agent-vault, unknown): the service id of the sign-in that gave the account
--                   its first tenant. Written once and never overwritten.
--   last_active_on  The last UTC day (YYYY-MM-DD) the account signed in or was served a
--                   signed-in page or API request. Written at most once a day per account.
--
-- Both are also added lazily at runtime (src/lib/accountActivity.ts,
-- ensureAccountActivityColumns, which runs these same two statements under a 2s lock_timeout the
-- first time a process needs them), so a deploy needs no hand-run step. Running this file by
-- hand first only saves the first signed-in request from doing it. Safe to run more than once.
-- Existing rows stay NULL: neither fact can be recovered for the past.
ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS signup_service TEXT;
ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS last_active_on TEXT;
