-- The service and country of each account's last sign-in, for the owner's list of last logins.
-- Mirror of migrations-pg/0074_auth_last_login_service.sql for the libSQL database.
ALTER TABLE auth_users ADD COLUMN last_login_service TEXT;
ALTER TABLE auth_users ADD COLUMN last_login_country TEXT;
