-- Track the last time a user authenticated so we can surface it in the account dropdown
ALTER TABLE auth_users ADD COLUMN last_login TEXT;
