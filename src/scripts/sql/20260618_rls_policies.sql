-- Phase 4: Row-Level Security — POSTGRES ONLY. Apply with src/scripts/applyRlsPolicies.mjs (NOT db:migrate).
-- Model: ENABLE (not FORCE). Web requests use a NON-owner role (subject to RLS) + shim SET LOCAL app.tenant_id/app.user_id.
-- Crons / data loader / migrations use the OWNER role (almstinsdata_user) which bypasses RLS as table owner under ENABLE.
-- App-level WHERE tenant_id filters stay in place (defense in depth). Re-runnable: drops policies first.
BEGIN;

-- ===== Tenant-scoped (67) — isolate by tenant_id =====
DROP POLICY IF EXISTS tenant_isolation ON address_fraud_reports;
ALTER TABLE address_fraud_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON address_fraud_reports
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

DROP POLICY IF EXISTS tenant_isolation ON address_labels;
ALTER TABLE address_labels ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON address_labels
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

DROP POLICY IF EXISTS tenant_isolation ON address_reviews;
ALTER TABLE address_reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON address_reviews
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

DROP POLICY IF EXISTS tenant_isolation ON admin_activity_log;
ALTER TABLE admin_activity_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON admin_activity_log
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

DROP POLICY IF EXISTS tenant_isolation ON asset_lifecycle_events;
ALTER TABLE asset_lifecycle_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON asset_lifecycle_events
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

DROP POLICY IF EXISTS tenant_isolation ON asset_lifecycle_groups;
ALTER TABLE asset_lifecycle_groups ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON asset_lifecycle_groups
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

DROP POLICY IF EXISTS tenant_isolation ON community_wallet_flags;
ALTER TABLE community_wallet_flags ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON community_wallet_flags
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

DROP POLICY IF EXISTS tenant_isolation ON dirty_tin_entries;
ALTER TABLE dirty_tin_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON dirty_tin_entries
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

DROP POLICY IF EXISTS tenant_isolation ON dirty_tins;
ALTER TABLE dirty_tins ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON dirty_tins
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

DROP POLICY IF EXISTS tenant_isolation ON exchange_accounts;
ALTER TABLE exchange_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON exchange_accounts
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

DROP POLICY IF EXISTS tenant_isolation ON global_address_label_votes;
ALTER TABLE global_address_label_votes ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON global_address_label_votes
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

DROP POLICY IF EXISTS tenant_isolation ON import_raw_rows;
ALTER TABLE import_raw_rows ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON import_raw_rows
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

DROP POLICY IF EXISTS tenant_isolation ON import_transactions;
ALTER TABLE import_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON import_transactions
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

DROP POLICY IF EXISTS tenant_isolation ON manual_cost_basis;
ALTER TABLE manual_cost_basis ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON manual_cost_basis
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

DROP POLICY IF EXISTS tenant_isolation ON memberships;
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON memberships
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

DROP POLICY IF EXISTS tenant_isolation ON monthly_digests;
ALTER TABLE monthly_digests ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON monthly_digests
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

DROP POLICY IF EXISTS tenant_isolation ON nft_hidden;
ALTER TABLE nft_hidden ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON nft_hidden
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

DROP POLICY IF EXISTS tenant_isolation ON nft_whitelist;
ALTER TABLE nft_whitelist ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON nft_whitelist
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

DROP POLICY IF EXISTS tenant_isolation ON petro_shared_cc;
ALTER TABLE petro_shared_cc ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON petro_shared_cc
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

DROP POLICY IF EXISTS tenant_isolation ON petro_splits;
ALTER TABLE petro_splits ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON petro_splits
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

DROP POLICY IF EXISTS tenant_isolation ON petro_splits_assignments;
ALTER TABLE petro_splits_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON petro_splits_assignments
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

DROP POLICY IF EXISTS tenant_isolation ON petro_splits_bills;
ALTER TABLE petro_splits_bills ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON petro_splits_bills
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

DROP POLICY IF EXISTS tenant_isolation ON petro_splits_carried;
ALTER TABLE petro_splits_carried ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON petro_splits_carried
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

DROP POLICY IF EXISTS tenant_isolation ON petro_splits_payments;
ALTER TABLE petro_splits_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON petro_splits_payments
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

DROP POLICY IF EXISTS tenant_isolation ON petro_splits_people;
ALTER TABLE petro_splits_people ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON petro_splits_people
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

DROP POLICY IF EXISTS tenant_isolation ON petro_subscriptions;
ALTER TABLE petro_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON petro_subscriptions
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

DROP POLICY IF EXISTS tenant_isolation ON petro_tin_entries;
ALTER TABLE petro_tin_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON petro_tin_entries
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

DROP POLICY IF EXISTS tenant_isolation ON petro_tins;
ALTER TABLE petro_tins ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON petro_tins
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

DROP POLICY IF EXISTS tenant_isolation ON petro_visits;
ALTER TABLE petro_visits ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON petro_visits
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

DROP POLICY IF EXISTS tenant_isolation ON portfolio_reconciliation;
ALTER TABLE portfolio_reconciliation ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON portfolio_reconciliation
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

DROP POLICY IF EXISTS tenant_isolation ON portfolio_reconciliation_assets;
ALTER TABLE portfolio_reconciliation_assets ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON portfolio_reconciliation_assets
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

DROP POLICY IF EXISTS tenant_isolation ON price_alert_preferences;
ALTER TABLE price_alert_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON price_alert_preferences
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

DROP POLICY IF EXISTS tenant_isolation ON promo_redemptions;
ALTER TABLE promo_redemptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON promo_redemptions
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

DROP POLICY IF EXISTS tenant_isolation ON protocol_positions;
ALTER TABLE protocol_positions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON protocol_positions
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

DROP POLICY IF EXISTS tenant_isolation ON reconciliation_notes;
ALTER TABLE reconciliation_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON reconciliation_notes
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

DROP POLICY IF EXISTS tenant_isolation ON subscriptions;
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON subscriptions
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

DROP POLICY IF EXISTS tenant_isolation ON sui_transactions;
ALTER TABLE sui_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON sui_transactions
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

DROP POLICY IF EXISTS tenant_isolation ON support_messages;
ALTER TABLE support_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON support_messages
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

DROP POLICY IF EXISTS tenant_isolation ON tax_1099_reconciliation;
ALTER TABLE tax_1099_reconciliation ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tax_1099_reconciliation
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

DROP POLICY IF EXISTS tenant_isolation ON tax_1099_uploads;
ALTER TABLE tax_1099_uploads ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tax_1099_uploads
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

DROP POLICY IF EXISTS tenant_isolation ON tax_classifications;
ALTER TABLE tax_classifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tax_classifications
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

DROP POLICY IF EXISTS tenant_isolation ON tax_disposals;
ALTER TABLE tax_disposals ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tax_disposals
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

DROP POLICY IF EXISTS tenant_isolation ON tax_documents;
ALTER TABLE tax_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tax_documents
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

DROP POLICY IF EXISTS tenant_isolation ON tax_lot_pins;
ALTER TABLE tax_lot_pins ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tax_lot_pins
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

DROP POLICY IF EXISTS tenant_isolation ON tax_lots;
ALTER TABLE tax_lots ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tax_lots
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

DROP POLICY IF EXISTS tenant_isolation ON tax_pipeline_runs;
ALTER TABLE tax_pipeline_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tax_pipeline_runs
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

DROP POLICY IF EXISTS tenant_isolation ON tax_review_items;
ALTER TABLE tax_review_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tax_review_items
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

DROP POLICY IF EXISTS tenant_isolation ON tax_wash_sales;
ALTER TABLE tax_wash_sales ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tax_wash_sales
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

DROP POLICY IF EXISTS tenant_isolation ON tenant_intake;
ALTER TABLE tenant_intake ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenant_intake
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

DROP POLICY IF EXISTS tenant_isolation ON tenant_memberships;
ALTER TABLE tenant_memberships ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenant_memberships
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

DROP POLICY IF EXISTS tenant_isolation ON tenant_settings;
ALTER TABLE tenant_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenant_settings
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

DROP POLICY IF EXISTS tenant_isolation ON tradfi_loan_payments;
ALTER TABLE tradfi_loan_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tradfi_loan_payments
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

DROP POLICY IF EXISTS tenant_isolation ON transaction_annotations;
ALTER TABLE transaction_annotations ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON transaction_annotations
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

DROP POLICY IF EXISTS tenant_isolation ON transaction_screenshots;
ALTER TABLE transaction_screenshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON transaction_screenshots
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

DROP POLICY IF EXISTS tenant_isolation ON transactions;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON transactions
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

DROP POLICY IF EXISTS tenant_isolation ON transfer_matches;
ALTER TABLE transfer_matches ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON transfer_matches
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

DROP POLICY IF EXISTS tenant_isolation ON user_scam_contracts;
ALTER TABLE user_scam_contracts ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON user_scam_contracts
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

DROP POLICY IF EXISTS tenant_isolation ON user_settings;
ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON user_settings
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

DROP POLICY IF EXISTS tenant_isolation ON users;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON users
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

DROP POLICY IF EXISTS tenant_isolation ON vault_notes;
ALTER TABLE vault_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON vault_notes
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

DROP POLICY IF EXISTS tenant_isolation ON wallet_claims;
ALTER TABLE wallet_claims ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON wallet_claims
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

DROP POLICY IF EXISTS tenant_isolation ON wallet_defi_sync;
ALTER TABLE wallet_defi_sync ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON wallet_defi_sync
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

DROP POLICY IF EXISTS tenant_isolation ON wallet_holdings_snapshot;
ALTER TABLE wallet_holdings_snapshot ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON wallet_holdings_snapshot
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

DROP POLICY IF EXISTS tenant_isolation ON wallet_nft_snapshot;
ALTER TABLE wallet_nft_snapshot ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON wallet_nft_snapshot
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

DROP POLICY IF EXISTS tenant_isolation ON wallet_snapshots;
ALTER TABLE wallet_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON wallet_snapshots
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

DROP POLICY IF EXISTS tenant_isolation ON wallet_sync_state;
ALTER TABLE wallet_sync_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON wallet_sync_state
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

DROP POLICY IF EXISTS tenant_isolation ON wallets;
ALTER TABLE wallets ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON wallets
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));


-- ===== tenants — a tenant sees only its own row =====
DROP POLICY IF EXISTS tenant_isolation ON tenants;
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenants
  USING (id = current_setting('app.tenant_id', true))
  WITH CHECK (id = current_setting('app.tenant_id', true));


-- ===== Per-user (3) — isolate by user_id =====
DROP POLICY IF EXISTS user_isolation ON alert_preferences;
ALTER TABLE alert_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY user_isolation ON alert_preferences
  USING (user_id = current_setting('app.user_id', true))
  WITH CHECK (user_id = current_setting('app.user_id', true));

DROP POLICY IF EXISTS user_isolation ON tracked_assets;
ALTER TABLE tracked_assets ENABLE ROW LEVEL SECURITY;
CREATE POLICY user_isolation ON tracked_assets
  USING (user_id = current_setting('app.user_id', true))
  WITH CHECK (user_id = current_setting('app.user_id', true));

DROP POLICY IF EXISTS user_isolation ON pinned_watchlist;
ALTER TABLE pinned_watchlist ENABLE ROW LEVEL SECURITY;
CREATE POLICY user_isolation ON pinned_watchlist
  USING (user_id = current_setting('app.user_id', true))
  WITH CHECK (user_id = current_setting('app.user_id', true));


-- ===== FK-scoped (1) — isolate via parent tenant =====
DROP POLICY IF EXISTS tenant_via_wallets ON protocol_events;
ALTER TABLE protocol_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_via_wallets ON protocol_events
  USING (wallet_id IN (SELECT id FROM wallets WHERE tenant_id = current_setting('app.tenant_id', true)))
  WITH CHECK (wallet_id IN (SELECT id FROM wallets WHERE tenant_id = current_setting('app.tenant_id', true)));


-- ===== Legacy / unowned (2) — fail-closed deny for web role; REVISIT if TradFi loans are wired up =====
ALTER TABLE tradfi_loans ENABLE ROW LEVEL SECURITY;  -- no policy => web role denied (fail-closed); owner retains access

ALTER TABLE tradfi_loan_archives ENABLE ROW LEVEL SECURITY;  -- no policy => web role denied (fail-closed); owner retains access


-- ===== Global reference (16) & auth infra (6) — intentionally NO RLS =====
-- GLOBAL: address_checks, url_checks, wallet_check_log, known_phishing_domains, global_address_labels, token_price_mapping, ip_geo_cache, cache, promo_codes, petro_promo_codes, request_log, request_agg_daily, demo_sessions, schema_migrations, db_identity, contact_messages
-- AUTH:   auth_users, auth_accounts, auth_credentials, auth_sessions, auth_verification_tokens, user_identities

COMMIT;
