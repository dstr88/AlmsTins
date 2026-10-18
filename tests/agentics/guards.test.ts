import { describe, it, expect, vi } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { brightLineViolations } from '../helpers/brightLineWording';

/**
 * Standing guards on the Agent Vault's files: the schema file and the code agree, the Vault keeps
 * to the bright lines (read-only, no custody, never in the transaction path; soft delete only;
 * not tax software), and its words keep the product's verb discipline. These read source, so they
 * fail the day someone adds a statement or an import that breaks a rule, not the day it is noticed.
 */

// store.ts imports the database; nothing here runs a query.
vi.mock('@/lib/db', () => ({ db: { execute: async () => { throw new Error('no database in this test'); } } }));

const ROOT = path.resolve(__dirname, '../..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

const walk = (dir: string, out: string[] = []): string[] => {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
};
const rel = (p: string) => path.relative(ROOT, p).split(path.sep).join('/');

/** Every file that is part of the Vault, as the repo has it today. */
const VAULT_FILES = [
  ...walk(path.join(ROOT, 'src/lib/agentVault')),
  ...walk(path.join(ROOT, 'src/pages/api/agentics')),
  path.join(ROOT, 'src/lib/agenticsAccess.ts'),
  path.join(ROOT, 'src/lib/agenticsFlag.mjs'),
  path.join(ROOT, 'migrations-pg/0050_agent_vault.sql'),
  path.join(ROOT, 'migrations-pg/0051_agent_events.sql'),
  path.join(ROOT, 'migrations-pg/0052_agent_watch_cursors.sql'),
  path.join(ROOT, 'migrations-pg/0053_agent_reports.sql'),
  path.join(ROOT, 'migrations-pg/0054_agent_report_delivery.sql'),
  path.join(ROOT, 'src/pages/api/cron/sync-agent-wallets.ts'),
  path.join(ROOT, 'src/pages/api/cron/agent-reports.ts'),
  path.join(ROOT, 'src/i18n/emails/agentReport.ts'),
  ...walk(path.join(ROOT, 'src/components/agentics')),
  ...walk(path.join(ROOT, 'src/pages/dashboard/agentics')),
].map(rel).sort();

/** SQL comments out, whitespace collapsed, spaces inside parentheses and before commas dropped. */
const squash = (sql: string) =>
  sql.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').replace(/\( /g, '(').replace(/ \)/g, ')').replace(/ ,/g, ',').trim();

describe('the schema file and the code create the same tables', () => {
  it('migrations-pg/0050_agent_vault.sql holds exactly the statements ensureAgentVaultTables runs, in order', async () => {
    const { AGENT_VAULT_DDL } = await import('../../src/lib/agentVault/store');
    const statements = squash(read('migrations-pg/0050_agent_vault.sql').replace(/--[^\n]*/g, ''))
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean);
    expect(statements).toEqual(AGENT_VAULT_DDL.map(squash));
  });

  it('is the next migration after 0049, and the only 0050', () => {
    const files = readdirSync(path.join(ROOT, 'migrations-pg')).sort();
    expect(files.filter((f) => f.startsWith('0050'))).toEqual(['0050_agent_vault.sql']);
    expect(files).toContain('0049_wallet_identity.sql');
  });

  it('the ledger is the next one after that, and the only 0051', () => {
    const files = readdirSync(path.join(ROOT, 'migrations-pg')).sort();
    expect(files.filter((f) => f.startsWith('0051'))).toEqual(['0051_agent_events.sql']);
  });

  it('the watcher cursors are 0052, the only 0052', () => {
    const files = readdirSync(path.join(ROOT, 'migrations-pg')).sort();
    expect(files.filter((f) => f.startsWith('0052'))).toEqual(['0052_agent_watch_cursors.sql']);
  });

  it('the operator reports are 0053, the only 0053', () => {
    const files = readdirSync(path.join(ROOT, 'migrations-pg')).sort();
    expect(files.filter((f) => f.startsWith('0053'))).toEqual(['0053_agent_reports.sql']);
  });

  it('report delivery is 0054, the only 0054; the only migration numbered higher is the door\'s 0060', () => {
    const files = readdirSync(path.join(ROOT, 'migrations-pg')).sort();
    expect(files.filter((f) => f.startsWith('0054'))).toEqual(['0054_agent_report_delivery.sql']);
    // The Vault's range is 0050 to 0059 and ends at 0054; the free-signup door's table is 0060
    // (migrations-pg/0060_agentics_signups.sql, not part of the Vault). Nothing else sits above 0054.
    expect(files.filter((f) => /^\d{4}_/.test(f) && Number(f.slice(0, 4)) > 54)).toEqual(['0060_agentics_signups.sql']);
  });

  it('every table is keyed by tenant_id, and soft-deletes with deleted_at', async () => {
    const { AGENT_VAULT_DDL } = await import('../../src/lib/agentVault/store');
    const tables = AGENT_VAULT_DDL.filter((s) => /^CREATE TABLE/.test(s));
    expect(tables).toHaveLength(3);
    for (const sql of tables) {
      expect(sql).toMatch(/\btenant_id\s+TEXT NOT NULL\b/);
      expect(sql).toMatch(/\bdeleted_at\s+TEXT\b/);
    }
  });

  it('has the columns the design names', async () => {
    const { AGENT_VAULT_DDL } = await import('../../src/lib/agentVault/store');
    const cols = (table: string) =>
      [...(AGENT_VAULT_DDL.find((s) => s.includes(`EXISTS ${table} (`)) ?? '').matchAll(/^\s{4}(\w+)\s/gm)].map((m) => m[1]);
    expect(cols('agent_tins')).toEqual(['id', 'tenant_id', 'label', 'agent_key_id', 'created_at', 'deleted_at']);
    expect(cols('agent_wallets')).toEqual(['id', 'tenant_id', 'tin_id', 'chain', 'address', 'created_at', 'deleted_at']);
    expect(cols('agent_destinations')).toEqual([
      'id', 'tenant_id', 'tin_id', 'chain', 'address', 'label', 'trust_status', 'trust_checked_at', 'trust_detail_json', 'created_at', 'deleted_at',
    ]);
  });

  it('limits trust_status to the three statuses in the table itself', async () => {
    const { AGENT_VAULT_DDL } = await import('../../src/lib/agentVault/store');
    const { TRUST_STATUSES } = await import('../../src/lib/agentVault/trustPolicy');
    const sql = AGENT_VAULT_DDL.find((s) => s.includes('agent_destinations (')) ?? '';
    const listed = [...(sql.match(/CHECK \(trust_status IN \(([^)]*)\)\)/)?.[1] ?? '').matchAll(/'(\w+)'/g)].map((m) => m[1]);
    expect(listed.sort()).toEqual([...TRUST_STATUSES].sort());
    expect(sql).toMatch(/trust_status\s+TEXT NOT NULL DEFAULT 'pending'/);
  });
});

describe('the ledger schema file and the code create the same table', () => {
  it('migrations-pg/0051_agent_events.sql holds exactly the statements ensureAgentEventsTable runs, in order', async () => {
    const { AGENT_EVENTS_DDL } = await import('../../src/lib/agentVault/events');
    const statements = squash(read('migrations-pg/0051_agent_events.sql').replace(/--[^\n]*/g, ''))
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean);
    expect(statements).toEqual(AGENT_EVENTS_DDL.map(squash));
  });

  it('is keyed by tenant_id, is never soft-deleted (it is append-only), and has the columns the design names', async () => {
    const { AGENT_EVENTS_DDL } = await import('../../src/lib/agentVault/events');
    const table = AGENT_EVENTS_DDL.find((s) => /^CREATE TABLE/.test(s)) ?? '';
    expect(table).toMatch(/\btenant_id\s+TEXT NOT NULL\b/);
    expect(table).not.toMatch(/\bdeleted_at\b/);
    expect(table).toMatch(/\boccurred_at\s+TEXT NOT NULL\b/);
    const cols = [...table.matchAll(/^\s{4}(\w+)\s/gm)].map((m) => m[1]).filter((c) => c !== 'CHECK');
    expect(cols).toEqual([
      'id', 'tenant_id', 'tin_id', 'kind', 'address', 'chain', 'answer', 'registry', 'status', 'key_id', 'source_ip',
      'tx_hash', 'direction', 'wallet', 'amount', 'asset', 'asset_contract', 'usd_value', 'block_number',
      'detail_json', 'occurred_at', 'created_at',
    ]);
  });

  it('refuses, in the table itself, a transaction stored without its facts', async () => {
    const { AGENT_EVENTS_DDL } = await import('../../src/lib/agentVault/events');
    const table = AGENT_EVENTS_DDL.find((s) => /^CREATE TABLE/.test(s)) ?? '';
    const rule = table.match(/^\s{4}CHECK \(kind <> 'transaction' OR \(([^)]*)\)\)/m)?.[1] ?? '';
    for (const col of ['chain', 'tx_hash', 'direction', 'wallet', 'amount', 'asset']) {
      expect(rule, col).toMatch(new RegExp(`\\b${col} IS NOT NULL\\b`));
    }
    expect(table).toMatch(/CHECK \(direction IN \('in', 'out'\)\)/);
  });

  it('limits kind, answer and registry to the words the code uses, in the table itself', async () => {
    const { AGENT_EVENTS_DDL, EVENT_KINDS, VAULT_ANSWERS, REGISTRY_VERDICTS } = await import('../../src/lib/agentVault/events');
    const table = AGENT_EVENTS_DDL.find((s) => /^CREATE TABLE/.test(s)) ?? '';
    const listed = (col: string) =>
      [...(table.match(new RegExp(`CHECK \\(${col} IN \\(([^)]*)\\)\\)`))?.[1] ?? '').matchAll(/'([\w-]+)'/g)].map((m) => m[1]);
    expect(listed('kind').sort()).toEqual([...EVENT_KINDS].sort());
    expect(listed('answer').sort()).toEqual([...VAULT_ANSWERS].sort());
    expect(listed('registry').sort()).toEqual([...REGISTRY_VERDICTS].sort());
  });

  it('the four verify-statuses are the four the design names', async () => {
    const { VAULT_ANSWERS } = await import('../../src/lib/agentVault/events');
    expect([...VAULT_ANSWERS]).toEqual(['proven', 'consistent-with-history', 'flagged', 'unknown']);
  });
});

describe('the watcher cursor schema file and the code create the same table', () => {
  it('migrations-pg/0052_agent_watch_cursors.sql holds exactly the statements ensureAgentWatchTables runs, in order', async () => {
    const { AGENT_WATCH_DDL } = await import('../../src/lib/agentVault/watchState');
    const statements = squash(read('migrations-pg/0052_agent_watch_cursors.sql').replace(/--[^\n]*/g, ''))
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean);
    expect(statements).toEqual(AGENT_WATCH_DDL.map(squash));
  });

  it('is keyed by tenant_id and is bookkeeping only: one row per wallet and destination pair', async () => {
    const { AGENT_WATCH_DDL } = await import('../../src/lib/agentVault/watchState');
    const table = AGENT_WATCH_DDL.find((s) => /^CREATE TABLE/.test(s)) ?? '';
    expect(table).toMatch(/\btenant_id\s+TEXT NOT NULL\b/);
    expect(table).toMatch(/PRIMARY KEY \(tenant_id, wallet_id, destination_id\)/);
    const cols = [...table.matchAll(/^\s{4}(\w+)\s/gm)].map((m) => m[1]).filter((c) => c !== 'PRIMARY');
    expect(cols).toEqual(['tenant_id', 'tin_id', 'wallet_id', 'destination_id', 'through_at', 'updated_at']);
  });

  it('is removed with the account, before the tins', async () => {
    const { TENANT_TABLES } = await import('../../src/lib/accountDeleteTables');
    const at = (t: string) => (TENANT_TABLES as readonly string[]).indexOf(t);
    expect(at('agent_watch_cursors')).toBeGreaterThanOrEqual(0);
    expect(at('agent_watch_cursors')).toBeLessThan(at('agent_tins'));
  });
});

describe('the reports schema file and the code create the same table', () => {
  it('migrations-pg/0053_agent_reports.sql holds exactly the statements ensureAgentReportsTable runs, in order', async () => {
    const { AGENT_REPORTS_DDL } = await import('../../src/lib/agentVault/reportStore');
    const statements = squash(read('migrations-pg/0053_agent_reports.sql').replace(/--[^\n]*/g, ''))
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean);
    expect(statements).toEqual(AGENT_REPORTS_DDL.map(squash));
  });

  it('is keyed by tenant_id, is never soft-deleted (it is append-only), and has the columns the design names', async () => {
    const { AGENT_REPORTS_DDL } = await import('../../src/lib/agentVault/reportStore');
    const table = AGENT_REPORTS_DDL.find((s) => /^CREATE TABLE/.test(s)) ?? '';
    expect(table).toMatch(/\btenant_id\s+TEXT NOT NULL\b/);
    expect(table).not.toMatch(/\bdeleted_at\b/);
    const cols = [...table.matchAll(/^\s{4}(\w+)\s/gm)].map((m) => m[1]).filter((c) => c !== 'CHECK');
    expect(cols).toEqual([
      'id', 'tenant_id', 'tin_id', 'period_start', 'period_end', 'version', 'generated_at', 'content_hash', 'summary_json',
      'merkle_root', 'leaf_count', 'signing_key_id', 'signature_hex', 'manifest_json', 'created_at',
    ]);
  });

  it('makes a version number unique per account, tin and period, in the table itself', async () => {
    const { AGENT_REPORTS_DDL } = await import('../../src/lib/agentVault/reportStore');
    expect(AGENT_REPORTS_DDL.some((s) => /^CREATE UNIQUE INDEX IF NOT EXISTS \w+ ON agent_reports \(tenant_id, tin_id, period_start, version\)$/.test(squash(s)))).toBe(true);
    // The insert's conflict target is that same key, so a taken version is skipped, never overwritten.
    expect(read('src/lib/agentVault/reportStore.ts')).toMatch(/ON CONFLICT \(tenant_id, tin_id, period_start, version\) DO NOTHING/);
  });
});

describe('the delivery schema file and the code create the same tables', () => {
  it('migrations-pg/0054_agent_report_delivery.sql holds exactly the statements ensureAgentDeliveryTables runs, in order', async () => {
    const { AGENT_DELIVERY_DDL } = await import('../../src/lib/agentVault/deliveryStore');
    const statements = squash(read('migrations-pg/0054_agent_report_delivery.sql').replace(/--[^\n]*/g, ''))
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean);
    expect(statements).toEqual(AGENT_DELIVERY_DDL.map(squash));
  });

  it('both tables are keyed by tenant_id, and settings are per account (one row each)', async () => {
    const { AGENT_DELIVERY_DDL } = await import('../../src/lib/agentVault/deliveryStore');
    const tables = AGENT_DELIVERY_DDL.filter((s) => /^CREATE TABLE/.test(s));
    expect(tables).toHaveLength(2);
    for (const sql of tables) expect(sql).toMatch(/\btenant_id\s+TEXT NOT NULL\b/);
    const settings = tables.find((s) => s.includes('agent_report_settings')) ?? '';
    expect(settings).toMatch(/tenant_id\s+TEXT NOT NULL PRIMARY KEY/);
    expect(settings).toMatch(/cadence\s+TEXT NOT NULL DEFAULT 'off'/);
    expect(settings).toMatch(/alerts\s+INTEGER NOT NULL DEFAULT 0/);
    const claims = tables.find((s) => s.includes('agent_alert_claims')) ?? '';
    expect(claims).toMatch(/PRIMARY KEY \(tenant_id, tin_id, address\)/);
  });

  it('limits the cadence to the words the code uses, in the table itself, and everything starts off', async () => {
    const { AGENT_DELIVERY_DDL, CADENCES } = await import('../../src/lib/agentVault/deliveryStore');
    const settings = AGENT_DELIVERY_DDL.find((s) => s.includes('agent_report_settings (')) ?? '';
    const listed = [...(settings.match(/CHECK \(cadence IN \(([^)]*)\)\)/)?.[1] ?? '').matchAll(/'(\w+)'/g)].map((m) => m[1]);
    expect(listed.sort()).toEqual([...CADENCES].sort());
    expect(CADENCES[0]).toBe('off');
  });

  it('are removed with the account, before the tin', async () => {
    const { TENANT_TABLES } = await import('../../src/lib/accountDeleteTables');
    const at = (t: string) => (TENANT_TABLES as readonly string[]).indexOf(t);
    for (const table of ['agent_report_settings', 'agent_alert_claims']) {
      expect(at(table), table).toBeGreaterThanOrEqual(0);
      expect(at(table), table).toBeLessThan(at('agent_tins'));
    }
  });

  it('nothing is ever sent from the Vault without an account having turned it on: one place touches the mailer, and only the two delivery files use that place', () => {
    // The shared mailer is reached through the Vault's own sender, which fails when nothing could be sent.
    const touchesSharedMailer = VAULT_FILES.filter((f) => /@\/lib\/email'|\bsendMail\(/.test(read(f))).sort();
    expect(touchesSharedMailer).toEqual(['src/lib/agentVault/mailer.ts']);
    const usesVaultSender = VAULT_FILES.filter((f) => f !== 'src/lib/agentVault/mailer.ts' && /\bsendVaultMail\b|\.\/mailer'/.test(read(f))).sort();
    expect(usesVaultSender).toEqual(['src/lib/agentVault/alerts.ts', 'src/lib/agentVault/reportJob.ts']);
  });
});

describe('the report migrations say what they mean about running twice', () => {
  it.each(['migrations-pg/0053_agent_reports.sql', 'migrations-pg/0054_agent_report_delivery.sql'])('%s says it is idempotent, in those words, and does not call itself safe', (file) => {
    const src = read(file);
    expect(src).toContain('-- Idempotent: running it again changes nothing.');
    expect(src).not.toMatch(/\bsafe\b/i);
  });
});

describe('reports are append-only', () => {
  const srcFiles = walk(path.join(ROOT, 'src')).filter((f) => /\.(ts|tsx|astro|mjs|js)$/.test(f));

  it('no file in src updates or removes a row of agent_reports', () => {
    for (const file of srcFiles) {
      const src = readFileSync(file, 'utf8');
      expect(src, rel(file)).not.toMatch(/\bUPDATE\s+agent_reports\b/i);
      expect(src, rel(file)).not.toMatch(/\bDELETE\s+FROM\s+agent_reports\b/i);
      expect(src, rel(file)).not.toMatch(/\bTRUNCATE\b[^;]*\bagent_reports\b/i);
    }
  });

  it('the only statement that writes it is one INSERT, in reportStore.ts', () => {
    const writers = srcFiles.filter((f) => /\bINSERT\s+INTO\s+agent_reports\b/i.test(readFileSync(f, 'utf8'))).map(rel);
    expect(writers).toEqual(['src/lib/agentVault/reportStore.ts']);
    expect(read('src/lib/agentVault/reportStore.ts').match(/\bINSERT\s+INTO\s+agent_reports\b/gi)).toHaveLength(1);
  });

  it('is removed with the account, before the tin', async () => {
    const { TENANT_TABLES } = await import('../../src/lib/accountDeleteTables');
    const at = (t: string) => (TENANT_TABLES as readonly string[]).indexOf(t);
    expect(at('agent_reports')).toBeGreaterThanOrEqual(0);
    expect(at('agent_reports')).toBeLessThan(at('agent_tins'));
  });
});

describe('the ledger is append-only', () => {
  const srcFiles = walk(path.join(ROOT, 'src')).filter((f) => /\.(ts|tsx|astro|mjs|js)$/.test(f));

  it('no file in src updates or removes a row of agent_events', () => {
    expect(srcFiles.length).toBeGreaterThan(100);
    for (const file of srcFiles) {
      const src = readFileSync(file, 'utf8');
      expect(src, rel(file)).not.toMatch(/\bUPDATE\s+agent_events\b/i);
      expect(src, rel(file)).not.toMatch(/\bDELETE\s+FROM\s+agent_events\b/i);
      expect(src, rel(file)).not.toMatch(/\bTRUNCATE\b[^;]*\bagent_events\b/i);
    }
  });

  it('the only statement that writes it is one INSERT, in events.ts', () => {
    const writers = srcFiles.filter((f) => /\bINSERT\s+INTO\s+agent_events\b/i.test(readFileSync(f, 'utf8'))).map(rel);
    expect(writers).toEqual(['src/lib/agentVault/events.ts']);
    expect(read('src/lib/agentVault/events.ts').match(/\bINSERT\s+INTO\s+agent_events\b/gi)).toHaveLength(1);
  });

  it('is removed with the account, children before the tin', async () => {
    const { TENANT_TABLES } = await import('../../src/lib/accountDeleteTables');
    const at = (t: string) => (TENANT_TABLES as readonly string[]).indexOf(t);
    expect(at('agent_events')).toBeGreaterThanOrEqual(0);
    expect(at('agent_events')).toBeLessThan(at('agent_tins'));
  });
});

describe('the Vault keeps to the bright lines', () => {
  it('finds the Vault files', () => {
    expect(VAULT_FILES).toEqual([
      'migrations-pg/0050_agent_vault.sql',
      'migrations-pg/0051_agent_events.sql',
      'migrations-pg/0052_agent_watch_cursors.sql',
      'migrations-pg/0053_agent_reports.sql',
      'migrations-pg/0054_agent_report_delivery.sql',
      'src/components/agentics/AgenticsShell.astro',
      'src/components/agentics/DeliverySettings.tsx',
      'src/components/agentics/ReportView.tsx',
      'src/components/agentics/ReportsPage.tsx',
      'src/components/agentics/agentics.css',
      'src/components/agentics/copy.ts',
      'src/components/agentics/errors.ts',
      'src/components/agentics/paths.ts',
      'src/i18n/emails/agentReport.ts',
      'src/lib/agentVault/addresses.ts',
      'src/lib/agentVault/alerts.ts',
      'src/lib/agentVault/api.ts',
      'src/lib/agentVault/checkLog.ts',
      'src/lib/agentVault/cronAuth.ts',
      'src/lib/agentVault/delivery.ts',
      'src/lib/agentVault/deliveryStore.ts',
      'src/lib/agentVault/digest.ts',
      'src/lib/agentVault/entitlements.ts',
      'src/lib/agentVault/errors.ts',
      'src/lib/agentVault/events.ts',
      'src/lib/agentVault/explorer.ts',
      'src/lib/agentVault/link.ts',
      'src/lib/agentVault/mailer.ts',
      'src/lib/agentVault/money.ts',
      'src/lib/agentVault/pricing.ts',
      'src/lib/agentVault/report.ts',
      'src/lib/agentVault/reportFormat.ts',
      'src/lib/agentVault/reportJob.ts',
      'src/lib/agentVault/reportPages.ts',
      'src/lib/agentVault/reportPdf.ts',
      'src/lib/agentVault/reportProof.ts',
      'src/lib/agentVault/reportStore.ts',
      'src/lib/agentVault/reportText.ts',
      'src/lib/agentVault/reports.ts',
      'src/lib/agentVault/store.ts',
      'src/lib/agentVault/transfers.ts',
      'src/lib/agentVault/trustChecks.ts',
      'src/lib/agentVault/trustPolicy.ts',
      'src/lib/agentVault/vault.ts',
      'src/lib/agentVault/watchState.ts',
      'src/lib/agentVault/watcher.ts',
      'src/lib/agenticsAccess.ts',
      'src/lib/agenticsFlag.mjs',
      'src/pages/api/agentics/destinations.ts',
      'src/pages/api/agentics/destinations/trust.ts',
      'src/pages/api/agentics/events.ts',
      'src/pages/api/agentics/plan.ts',
      'src/pages/api/agentics/refresh.ts',
      'src/pages/api/agentics/report-settings.ts',
      'src/pages/api/agentics/reports.ts',
      'src/pages/api/agentics/reports/bundle.ts',
      'src/pages/api/agentics/reports/pdf.ts',
      'src/pages/api/agentics/tins.ts',
      'src/pages/api/agentics/totals.ts',
      'src/pages/api/agentics/wallets.ts',
      'src/pages/api/cron/agent-reports.ts',
      'src/pages/api/cron/sync-agent-wallets.ts',
      // The free-signup door's welcome letter. It is not Vault code, but it shares the directory,
      // so the Vault's wording and bright-line guards read it too (stricter, never looser).
      'src/pages/dashboard/agentics/index.astro',
      'src/pages/dashboard/agentics/reports.astro',
      'src/pages/dashboard/agentics/reports/[id].astro',
    ]);
  });

  it('soft delete only: nothing in the Vault deletes, drops or truncates a row', () => {
    for (const file of VAULT_FILES) {
      const src = read(file);
      expect(src, file).not.toMatch(/\bDELETE\s+FROM\b/i);
      expect(src, file).not.toMatch(/\bDROP\s+(TABLE|INDEX|COLUMN)\b/i);
      expect(src, file).not.toMatch(/\bTRUNCATE\b/i);
    }
  });

  it('read-only, no custody, never in the transaction path: no signing library, no key, no way to send', () => {
    for (const file of VAULT_FILES.filter((f) => f.endsWith('.ts'))) {
      const src = read(file);
      const imports = [...src.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
      for (const spec of imports) {
        expect(spec, `${file} imports ${spec}`).not.toMatch(/^(ethers|viem|web3|@noble\/(secp256k1|curves)|bip39|bip32|hdkey|@solana\/web3\.js|bitcoinjs-lib|@zerodev)/);
      }
      expect(src, file).not.toMatch(/\b(sendRawTransaction|sendTransaction|signTransaction|signMessage|signTypedData|privateKey|mnemonic)\b/i);
    }
  });

  it('not tax software: nothing about cost basis, gains or profit', () => {
    for (const file of VAULT_FILES) {
      expect(read(file), file).not.toMatch(/cost[ -]basis|capital gain|realized|unrealized|\bP\/L\b|\bprofit|\b8949\b/i);
    }
  });

  it('no attribution: nothing in the Vault names a person or looks an address up as someone', () => {
    for (const file of VAULT_FILES.filter((f) => f.endsWith('.ts'))) {
      expect(read(file), file).not.toMatch(/\b(kyc|de-?anonymi[sz]|cluster(ing)?|reverse[- ]lookup|who owns)\b/i);
    }
  });

  it('the report, delivery and job code assumes nothing about who the owner is: the gate is the only place that knows', () => {
    const slice4 = VAULT_FILES.filter(
      (f) =>
        /^src\/lib\/agentVault\/(report\w*|reports|delivery\w*|digest|alerts|money|errors)\.ts$/.test(f) ||
        /^src\/pages\/api\/agentics\/(reports|report-settings)/.test(f) ||
        f === 'src/pages/api/cron/agent-reports.ts' ||
        f === 'src/i18n/emails/agentReport.ts',
    );
    expect(slice4.length).toBeGreaterThan(15);
    for (const file of slice4) {
      expect(read(file), file).not.toMatch(/@\/lib\/owner|OWNER_TENANT_ID|\bisOwner\b|titaniumhut|donnie@|ADMIN_(EMAIL|TENANT)/);
    }
  });

  it('only the plan and the gate know who the owner is: no other Vault file names the owner', () => {
    const knows = VAULT_FILES.filter((f) => /@\/lib\/owner|\.\/owner'|OWNER_TENANT_ID|\bisOwner\b|titaniumhut|donnie@/.test(read(f))).sort();
    expect(knows).toEqual(['src/lib/agentVault/entitlements.ts', 'src/lib/agenticsAccess.ts']);
  });

  it('never accepts a tenant id from a client', () => {
    for (const file of VAULT_FILES.filter((f) => f.startsWith('src/pages/api/agentics/'))) {
      const src = read(file);
      expect(src, file).not.toMatch(/body\.tenant|\.tenantId\b.*body|searchParams\.get\(\s*['"]tenant/i);
    }
  });
});

describe('the Vault keeps to the product wording', () => {
  it.each(VAULT_FILES)('%s: Almstins verifies, warns and flags, and never says it stops anything (American English)', (file) => {
    expect(brightLineViolations(read(file))).toEqual([]);
  });

  it('Pass and Trusted are never described as safe', () => {
    for (const file of VAULT_FILES) {
      // Comment markers out, then whole sentences: "never a statement that the address is safe" is
      // fine, "the address is safe" is not.
      const prose = read(file).split('\n').map((l) => l.replace(/^\s*(\*|\/\/|--)\s?/, '')).join(' ');
      for (const sentence of prose.split(/(?<=[.!?])\s+/)) {
        if (/\b(is|are|means|marks?|certif(y|ies)|declares?|guarantees?)\b[^.]*\bsafe\b/i.test(sentence)) {
          expect(sentence, `${file}: ${sentence.trim()}`).toMatch(/\b(never|not|no|isn't)\b/i);
        }
      }
    }
  });
});
