-- Record when and which version of Terms + Privacy Policy a user accepted at signup.
-- NULL = account created before this feature (existing users, OAuth signups).
ALTER TABLE auth_users
  ADD COLUMN IF NOT EXISTS terms_accepted_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS terms_version      TEXT;
