-- The two sign-in token tables: signup_verification_tokens (password sign-up's
-- /verify-email link) and auth_verification_tokens (Auth.js magic links).
--
-- Both were only ever created by the pre-Postgres migrations (migrations/0005_auth.sql,
-- 0007_auth_credentials.sql). Also created lazily at runtime (src/lib/authTokenTables.ts);
-- this migration is the durable mirror. A table that already exists is left untouched,
-- indexes included.
--
-- Apply AFTER the deploy that requires verified email is live, never before: under the
-- previous code, opening a sign-up verification link verified the address with no
-- confirmation step, so creating signup_verification_tokens early would switch that path
-- back on.
DO $$
BEGIN
  IF to_regclass('signup_verification_tokens') IS NULL THEN
    CREATE TABLE signup_verification_tokens (
      identifier TEXT NOT NULL,
      token      TEXT NOT NULL,
      expires    TEXT NOT NULL
    );
    CREATE UNIQUE INDEX signup_verification_tokens_idx
      ON signup_verification_tokens (identifier, token);
  END IF;
  IF to_regclass('auth_verification_tokens') IS NULL THEN
    CREATE TABLE auth_verification_tokens (
      identifier TEXT NOT NULL,
      token      TEXT NOT NULL,
      expires    TEXT NOT NULL
    );
    CREATE UNIQUE INDEX auth_verification_tokens_idx
      ON auth_verification_tokens (identifier, token);
  END IF;
END $$;
