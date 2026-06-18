// Phase 4 — generate the RLS policy migration from an explicit, auditable
// classification of all 96 tables. Connects read-only to verify coverage
// (every base table classified exactly once; tenant-scoped really have
// tenant_id), then writes src/scripts/sql/20260618_rls_policies.sql.
//   node --env-file=.env src/scripts/genRlsPolicies.mjs
import pg from 'pg';
import fs from 'node:fs';

// ── Classification (security decision lives here, in one reviewable place) ──

// Tenant data keyed by tenant_id → standard fail-closed policy.
const TENANT = [
  'address_fraud_reports','address_labels','address_reviews','admin_activity_log','asset_lifecycle_events',
  'asset_lifecycle_groups','community_wallet_flags','dirty_tin_entries','dirty_tins','exchange_accounts',
  'global_address_label_votes','import_raw_rows','import_transactions','manual_cost_basis','memberships',
  'monthly_digests','nft_hidden','nft_whitelist','petro_shared_cc','petro_splits','petro_splits_assignments',
  'petro_splits_bills','petro_splits_carried','petro_splits_payments','petro_splits_people','petro_subscriptions',
  'petro_tin_entries','petro_tins','petro_visits','portfolio_reconciliation','portfolio_reconciliation_assets',
  'price_alert_preferences','promo_redemptions','protocol_positions','reconciliation_notes','subscriptions',
  'sui_transactions','support_messages','tax_1099_reconciliation','tax_1099_uploads','tax_classifications',
  'tax_disposals','tax_documents','tax_lot_pins','tax_lots','tax_pipeline_runs','tax_review_items',
  'tax_wash_sales','tenant_intake','tenant_memberships','tenant_settings','tradfi_loan_payments',
  'transaction_annotations','transaction_screenshots','transactions','transfer_matches','user_scam_contracts',
  'user_settings','users','vault_notes','wallet_claims','wallet_defi_sync','wallet_holdings_snapshot',
  'wallet_nft_snapshot','wallet_snapshots','wallet_sync_state','wallets',
];

// The tenant registry itself — a tenant may see only its own row (id = tenant).
const TENANT_SELF = ['tenants'];

// Active per-user data keyed by user_id → isolate by app.user_id.
const USER = ['alert_preferences','tracked_assets','pinned_watchlist'];

// Tenant data reached only via a FK to a tenant-scoped parent → subquery policy.
const FK = { protocol_events: { col: 'wallet_id', parent: 'wallets', parentKey: 'id' } };

// No owner column + no code/migration references → fail-closed deny for the web
// role (ENABLE RLS, no permissive policy). Owner keeps access. REVISIT if wired up.
const LEGACY_DENY = ['tradfi_loans','tradfi_loan_archives'];

// Shared/public data or infra — intentionally NOT tenant-scoped. No RLS.
const GLOBAL = [
  'address_checks','url_checks','wallet_check_log','known_phishing_domains','global_address_labels',
  'token_price_mapping','ip_geo_cache','cache','promo_codes','petro_promo_codes','request_log',
  'request_agg_daily','demo_sessions','schema_migrations','db_identity','contact_messages',
];

// Pre-tenant auth (credentials / sessions / tokens, keyed by user_id or token).
// Touched before a tenant context exists → governed by app auth, not RLS.
const AUTH = ['auth_users','auth_accounts','auth_credentials','auth_sessions','auth_verification_tokens','user_identities'];

const POL_T = (t, key) =>
  `ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY;\nCREATE POLICY tenant_isolation ON ${t}\n  USING (${key} = current_setting('app.tenant_id', true))\n  WITH CHECK (${key} = current_setting('app.tenant_id', true));\n`;
const POL_U = (t) =>
  `ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY;\nCREATE POLICY user_isolation ON ${t}\n  USING (user_id = current_setting('app.user_id', true))\n  WITH CHECK (user_id = current_setting('app.user_id', true));\n`;
const POL_FK = (t, { col, parent, parentKey }) => {
  const sub = `${col} IN (SELECT ${parentKey} FROM ${parent} WHERE tenant_id = current_setting('app.tenant_id', true))`;
  return `ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY;\nCREATE POLICY tenant_via_${parent} ON ${t}\n  USING (${sub})\n  WITH CHECK (${sub});\n`;
};
const POL_DENY = (t) =>
  `ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY;  -- no policy => web role denied (fail-closed); owner retains access\n`;

// ── Verify coverage against the live schema, then emit ──
const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const all = (await c.query("select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by 1")).rows.map(r => r.table_name);
const withTenant = new Set((await c.query("select distinct table_name from information_schema.columns where table_schema='public' and column_name='tenant_id'")).rows.map(r => r.table_name));

const fkTables = Object.keys(FK);
const classified = [...TENANT, ...TENANT_SELF, ...USER, ...fkTables, ...LEGACY_DENY, ...GLOBAL, ...AUTH];
const seen = new Set(); const dupes = classified.filter(t => seen.size === seen.add(t).size);
const missing = all.filter(t => !seen.has(t));
const extra = classified.filter(t => !all.includes(t));
const tenantNoCol = TENANT.filter(t => !withTenant.has(t));

const problems = [];
if (dupes.length) problems.push('CLASSIFIED TWICE: ' + dupes.join(', '));
if (missing.length) problems.push('UNCLASSIFIED TABLES: ' + missing.join(', '));
if (extra.length) problems.push('CLASSIFIED BUT NOT IN DB: ' + extra.join(', '));
if (tenantNoCol.length) problems.push('TENANT LIST BUT NO tenant_id COLUMN: ' + tenantNoCol.join(', '));
if (problems.length) { console.error('COVERAGE CHECK FAILED:\n  ' + problems.join('\n  ')); await c.end(); process.exit(1); }
console.log(`coverage OK: ${all.length} tables = ${TENANT.length} tenant + ${TENANT_SELF.length} self + ${USER.length} user + ${fkTables.length} fk + ${LEGACY_DENY.length} legacy-deny + ${GLOBAL.length} global + ${AUTH.length} auth`);

const out = [];
out.push('-- Phase 4: Row-Level Security — POSTGRES ONLY. Apply with src/scripts/applyRlsPolicies.mjs (NOT db:migrate).');
out.push('-- Model: ENABLE (not FORCE). Web requests use a NON-owner role (subject to RLS) + shim SET LOCAL app.tenant_id/app.user_id.');
out.push('-- Crons / data loader / migrations use the OWNER role (almstinsdata_user) which bypasses RLS as table owner under ENABLE.');
out.push('-- App-level WHERE tenant_id filters stay in place (defense in depth). Re-runnable: drops policies first.');
out.push('BEGIN;');
out.push('\n-- ===== Tenant-scoped (' + TENANT.length + ') — isolate by tenant_id =====');
for (const t of TENANT) { out.push(`DROP POLICY IF EXISTS tenant_isolation ON ${t};`); out.push(POL_T(t, 'tenant_id')); }
out.push('\n-- ===== tenants — a tenant sees only its own row =====');
for (const t of TENANT_SELF) { out.push(`DROP POLICY IF EXISTS tenant_isolation ON ${t};`); out.push(POL_T(t, 'id')); }
out.push('\n-- ===== Per-user (' + USER.length + ') — isolate by user_id =====');
for (const t of USER) { out.push(`DROP POLICY IF EXISTS user_isolation ON ${t};`); out.push(POL_U(t)); }
out.push('\n-- ===== FK-scoped (' + fkTables.length + ') — isolate via parent tenant =====');
for (const t of fkTables) { out.push(`DROP POLICY IF EXISTS tenant_via_${FK[t].parent} ON ${t};`); out.push(POL_FK(t, FK[t])); }
out.push('\n-- ===== Legacy / unowned (' + LEGACY_DENY.length + ') — fail-closed deny for web role; REVISIT if TradFi loans are wired up =====');
for (const t of LEGACY_DENY) out.push(POL_DENY(t));
out.push('\n-- ===== Global reference (' + GLOBAL.length + ') & auth infra (' + AUTH.length + ') — intentionally NO RLS =====');
out.push('-- GLOBAL: ' + GLOBAL.join(', '));
out.push('-- AUTH:   ' + AUTH.join(', '));
out.push('\nCOMMIT;');

fs.mkdirSync('src/scripts/sql', { recursive: true });
fs.writeFileSync('src/scripts/sql/20260618_rls_policies.sql', out.join('\n') + '\n');
console.log('wrote src/scripts/sql/20260618_rls_policies.sql (' + (TENANT.length + TENANT_SELF.length + USER.length + fkTables.length + LEGACY_DENY.length) + ' tables get RLS, ' + (GLOBAL.length + AUTH.length) + ' intentionally exempt)');
await c.end();
