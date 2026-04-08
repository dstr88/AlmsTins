-- Separate alert email for notifications (health factor alerts, etc.)
-- Kept distinct from the account/login email intentionally:
--   • users who signed up anonymously can add an alert address without
--     changing their login
--   • users may prefer alerts go to a different inbox than their account
ALTER TABLE auth_users ADD COLUMN alert_email TEXT;
