-- Stored per-user language preference (Phase 2 i18n).
-- Powers transactional emails sent outside a request (cron digests, price/health
-- alerts, promo expiry, Stripe webhook receipts) — these have no almstins-lang cookie,
-- so they read the user's stored preference. Mirrors the cookie value, persisted when
-- the user switches language in the dashboard and on signup.
ALTER TABLE auth_users ADD COLUMN lang TEXT NOT NULL DEFAULT 'en';
