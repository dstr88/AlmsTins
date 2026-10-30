// The tables self-serve account deletion empties (src/pages/api/account/delete.ts).
// A list rather than a catalog query, so what gets deleted is reviewable in one place;
// tests/privacy/accountDeleteCoverage.test.ts fails when a per-account table is added
// anywhere in the code and is missing here, from deleteVerifyAccountData, or from the
// test's kept list.

/**
 * Per-account tables keyed by tenant_id, children before parents. Kept on purpose, and
 * so not listed: the receivables and milestone desk records other parties rely on
 * (see src/lib/verifyAccountDelete.ts). Verify's own tables go in deleteVerifyAccountData.
 */
export const TENANT_TABLES = [
  // PetroTins
  'petro_tin_entries', 'petro_tins', 'petro_receipts', 'petro_shared_cc', 'petro_splits_assignments',
  'petro_splits_payments', 'petro_splits_bills', 'petro_splits_carried', 'petro_splits_people', 'petro_splits',
  'petro_subscriptions', 'petro_visits', 'dirty_tin_entries', 'dirty_tins',
  // Agentics signups (where the account came in, and whether its welcome letter went out)
  'agentics_signups',
  // Agent Vault (the owner's own records: delivery settings and alert claims, the ledger, its reports and the watcher's cursors, then destinations, then wallets, then tins)
  'agent_alert_claims', 'agent_report_settings', 'agent_reports', 'agent_events', 'agent_watch_cursors', 'agent_destinations', 'agent_wallets', 'agent_tins',
  // Transactions, imports and wallets
  'transaction_annotations', 'transaction_screenshots', 'transfer_matches', 'transactions', 'sui_transactions',
  'import_raw_rows', 'import_transactions', 'exchange_accounts', 'manual_cost_basis', 'protocol_positions',
  'wallet_holdings_snapshot', 'wallet_nft_snapshot', 'wallet_snapshots', 'wallet_defi_sync', 'wallet_sync_state',
  'wallet_claims', 'nft_hidden', 'nft_whitelist', 'user_scam_contracts', 'wallet_identity', 'wallets',
  'asset_lifecycle_events', 'asset_lifecycle_groups',
  // Tax
  'tax_1099_reconciliation', 'tax_1099_uploads', 'tax_classifications', 'tax_disposals', 'tax_documents',
  'tax_lot_pins', 'tax_wallet_allocation_override', 'tax_lots', 'tax_pipeline_runs', 'tax_review_items', 'tax_wash_sales',
  'record_proof_snapshot', 'record_proofs', 'lot_identification_confirmed', 'lot_identification_stamps', 'lot_identifications', 'tradfi_loan_payments',
  // Shared files: the owner's copies and their download log (log before the shares it refers to)
  'file_share_log', 'file_shares',
  // Notes, labels, settings and alerts
  'vault_notes', 'vault_error_alerts', 'reconciliation_notes', 'portfolio_reconciliation_assets',
  'portfolio_reconciliation', 'address_labels', 'address_labels_new', 'global_address_label_votes',
  'price_alerts', 'price_alert_preferences', 'monthly_digests', 'tenant_settings', 'user_settings', 'tenant_intake',
  'tenant_outbound_emails',
  // Community contributions, support, billing and the operator's activity log
  'address_fraud_reports', 'address_reviews', 'community_wallet_flags', 'support_messages',
  'subscriptions', 'admin_activity_log',
  // The legacy profile row and memberships
  'users', 'memberships',
] as const;

/** Per-user tables keyed by user_id. */
export const USER_TABLES = [
  'alert_preferences', 'tracked_assets', 'pinned_watchlist', 'campaign_drip',
  'auth_accounts', 'auth_credentials', 'auth_sessions',
] as const;
