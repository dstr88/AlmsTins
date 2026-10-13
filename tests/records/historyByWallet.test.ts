import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import JSZip from 'jszip';

/**
 * History by wallet (GET /api/records/history-by-wallet, paid plans) and the plain CSV
 * (GET /api/transactions/export, every plan), built from one row builder
 * (src/lib/historyRows.ts) and one file writer (src/lib/historyExport.ts).
 *
 *   - Every query is scoped by the session's tenant_id, and every JOIN matches within it.
 *   - A wallet filter applies to every half (imported, on-chain, Sui), not just on-chain.
 *   - Duplicates are skipped, Sui is included, failed transactions move nothing.
 *   - Every cell is protected against spreadsheet formulas.
 *   - Imported rows with no account land in a per-exchange unassigned bucket.
 *   - One EVM address on two chains is two wallets.
 *   - Free accounts get a 403 before any data is read; any paid plan and the owner get the ZIP.
 *   - More rows than MAX_HISTORY_ROWS is a 413 before any row is loaded; one build per
 *     account at a time (429).
 *
 * Hermetic: the session, the plan and the database are stubs. The database stub answers each
 * statement from in-memory fixtures and applies the WHERE clauses the code sends, so a filter
 * the code forgets shows up as extra rows.
 */

const TENANT = 'tenant-a';
const OTHER = 'tenant-b';
const EVM = '0xabcdef0123456789abcdef0123456789abcdef01';
const DEAD = '0x000000000000000000000000000000000000dead';
const FEED = '0x000000000000000000000000000000000000feed';
const SOL = '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin';
const BTC = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
const SUI = '0x' + 'ab'.repeat(32);
const ACCT1 = '11111111-1111-4111-8111-111111111111';
const ACCT2 = '22222222-2222-4222-8222-222222222222';
const ACCT_BTC = '33333333-3333-4333-8333-333333333333';
const ACCT_OTHER = '44444444-4444-4444-8444-444444444444';
const FORMULA_SYMBOL = '=HYPERLINK("http://x.test","y")';

type Row = Record<string, unknown>;

const state = vi.hoisted(() => ({
	session: null as null | { tenantId: string; isDemo?: boolean },
	plan: 'starter',
	calls: [] as Array<{ sql: string; args: unknown[] }>,
	identity: [] as Array<Record<string, unknown>>,
}));

const fx = {
	wallets: [
		{ id: 'w-evm', tenant_id: TENANT, address: EVM, label: 'Main', wallet_type: 'onchain' },
		{ id: 'w-sol', tenant_id: TENANT, address: SOL, label: null, wallet_type: 'onchain' },
		{ id: 'w-sui', tenant_id: TENANT, address: SUI, label: 'Sui One', wallet_type: 'onchain' },
		{ id: 'w-btc', tenant_id: TENANT, address: BTC, label: 'Cold BTC', wallet_type: 'onchain' },
		{ id: 'w-mirror', tenant_id: TENANT, address: `cex:crypto_com:${ACCT1}`, label: 'Crypto.com Account #1', wallet_type: 'exchange' },
		{ id: 'w-other', tenant_id: OTHER, address: FEED, label: 'Not yours', wallet_type: 'onchain' },
	] as Row[],
	accounts: [
		{ id: ACCT1, tenant_id: TENANT, source: 'crypto_com', name: 'Account #1' },
		{ id: ACCT2, tenant_id: TENANT, source: 'crypto_com', name: 'Account #2' },
		{ id: ACCT_BTC, tenant_id: TENANT, source: 'bitcoin', name: 'Bitcoin Wallet (bc1q…)' },
		{ id: ACCT_OTHER, tenant_id: OTHER, source: 'crypto_com', name: 'Their account' },
	] as Row[],
	imports: [
		{ id: 'i1', tenant_id: TENANT, source: 'crypto_com', account_id: ACCT1, wallet_id: null, timestamp_utc: '2025-02-01 10:00:00', asset_symbol: 'CRO', currency: 'CRO', amount: 100, direction: 'in', native_usd: 12.5, kind: 'crypto_earn', description: 'Earn', is_duplicate: 0 },
		{ id: 'i2', tenant_id: TENANT, source: 'crypto_com', account_id: ACCT2, wallet_id: null, timestamp_utc: '2025-03-01T00:00:00.000Z', asset_symbol: 'ETH', currency: 'ETH', amount: -0.5, direction: 'out', native_usd: -1500, fee_native: 0.001, fee_currency: 'ETH', notes: 'to cold', is_duplicate: 0 },
		{ id: 'i3', tenant_id: TENANT, source: 'crypto_com', account_id: null, wallet_id: null, timestamp_utc: '2025-04-01 00:00:00', asset_symbol: FORMULA_SYMBOL, amount: 1, direction: 'in', is_duplicate: null },
		{ id: 'i4', tenant_id: TENANT, source: 'bitcoin', account_id: ACCT_BTC, wallet_id: 'w-btc', timestamp_utc: '2025-05-01T12:00:00Z', asset_symbol: 'BTC', amount: 0.01, direction: 'in', tx_hash: 'f'.repeat(64), is_duplicate: 0 },
		{ id: 'i5', tenant_id: TENANT, source: 'crypto_com', account_id: ACCT1, wallet_id: null, timestamp_utc: '2025-02-01 10:00:00', asset_symbol: 'CRO', amount: 100, direction: 'in', is_duplicate: 1 },
		{ id: 'i6', tenant_id: TENANT, source: 'crypto_com', account_id: ACCT1, wallet_id: null, timestamp_utc: '2024-12-31 23:59:59', asset_symbol: 'CRO', amount: 7, direction: 'in', is_duplicate: 0 },
		{ id: 'i7', tenant_id: TENANT, source: 'crypto_com', account_id: ACCT1, wallet_id: null, timestamp_utc: '2025-06-01 00:00:00', asset_symbol: 'USDC', amount: 5, direction: 'out', is_duplicate: 2 },
		{ id: 'i-other', tenant_id: OTHER, source: 'crypto_com', account_id: ACCT_OTHER, wallet_id: null, timestamp_utc: '2025-02-02 00:00:00', asset_symbol: 'SECRET', amount: 9, direction: 'in', is_duplicate: 0 },
	] as Row[],
	onchain: [
		{ id: 't1', tenant_id: TENANT, wallet_id: 'w-evm', chain: 'ethereum', hash: '0x' + '1'.repeat(64), timestamp: '2025-01-15T08:00:00.000Z', from_address: EVM, to_address: DEAD, value: '1500000000000000000', token_symbol: 'native', token_decimals: 18, tx_type: 'outgoing', status: 'confirmed', fee_paid: '21000000000000', usd_value: 3000, is_duplicate: 0 },
		{ id: 't2', tenant_id: TENANT, wallet_id: 'w-evm', chain: 'polygon', hash: '0x' + '2'.repeat(64), timestamp: '2025-01-20T08:00:00.000Z', from_address: FEED, to_address: EVM, value: '2500000', token_symbol: 'USDC', token_decimals: 6, tx_type: 'token_in', status: 'confirmed', fee_paid: null, usd_value: null, is_duplicate: 0 },
		{ id: 't3', tenant_id: TENANT, wallet_id: 'w-evm', chain: 'ethereum', hash: '0x' + '3'.repeat(64), timestamp: '2025-01-25T08:00:00.000Z', from_address: EVM, to_address: DEAD, value: '2000000000000000000', token_symbol: 'native', token_decimals: 18, tx_type: 'outgoing', status: 'failed', fee_paid: '1000000000000', usd_value: 5000, is_duplicate: 0 },
		{ id: 't4', tenant_id: TENANT, wallet_id: 'w-evm', chain: 'ethereum', hash: '0x' + '4'.repeat(64), timestamp: '2025-01-26T08:00:00.000Z', from_address: EVM, to_address: DEAD, value: '1', token_symbol: 'native', token_decimals: 18, tx_type: 'outgoing', status: 'confirmed', is_duplicate: 1 },
		{ id: 't-other', tenant_id: OTHER, wallet_id: 'w-other', chain: 'ethereum', hash: '0x' + '9'.repeat(64), timestamp: '2025-01-15T08:00:00.000Z', from_address: FEED, to_address: DEAD, value: '1', token_symbol: 'native', token_decimals: 18, tx_type: 'outgoing', status: 'confirmed', is_duplicate: 0 },
	] as Row[],
	annotations: [
		{ tenant_id: TENANT, transaction_id: 't2', note: 'payment', category: 'income' },
		{ tenant_id: OTHER, transaction_id: 't1', note: 'LEAKED NOTE', category: 'leak' },
	] as Row[],
	sui: [
		{ id: 's1', tenant_id: TENANT, wallet_id: 'w-sui', digest: 'Dig1', coin_type: '0x2::sui::SUI', symbol: 'SUI', amount: '-1000000000', decimals: 9, timestamp: '2025-07-01T00:00:00.000Z', fee_mist: '2000000', status: 'success', note: null, category: null },
		{ id: 's2', tenant_id: TENANT, wallet_id: 'w-sui', digest: 'Dig2', coin_type: '0x2::sui::SUI', symbol: 'SUI', amount: '0', decimals: 9, timestamp: '2025-07-02T00:00:00.000Z', fee_mist: '0', status: 'success' },
	] as Row[],
	labels: [
		{ tenant_id: TENANT, address: DEAD, label: '@burn', source: 'user', created_at: '2025-01-01' },
		{ tenant_id: OTHER, address: FEED, label: 'LEAKED LABEL', source: 'user', created_at: '2025-01-01' },
	] as Row[],
};

const IMPORT_COLUMNS = [
	'id', 'tenant_id', 'source', 'import_batch_id', 'timestamp_utc', 'description', 'currency', 'amount', 'to_currency',
	'to_amount', 'native_currency', 'native_amount', 'native_usd', 'kind', 'tx_hash', 'direction', 'asset_symbol', 'notes',
	'category', 'group_id', 'fee_usd', 'fee_native', 'fee_currency', 'account_id', 'wallet_id', 'is_duplicate',
];

/** Apply the clauses the code sent, in the order it builds them. */
function filterRows(
	rows: Row[],
	sql: string,
	args: unknown[],
	o: { timeSql: string; walletSql: string; dupSql?: string; dupField?: string },
): Row[] {
	let i = 0;
	const tenant = args[i++];
	let out = rows.filter((r) => r.tenant_id === tenant);
	if (o.dupSql && sql.includes(`(${o.dupSql} IS NULL OR`)) {
		out = out.filter((r) => r[o.dupField!] == null || r[o.dupField!] === 0 || r[o.dupField!] === -1);
	}
	if (sql.includes(`${o.timeSql} >= ?`)) {
		const [lo, hi] = [String(args[i++]), String(args[i++])];
		const field = o.timeSql.replace(/^\w+\./, '');
		out = out.filter((r) => String(r[field]) >= lo && String(r[field]) < hi);
	}
	if (sql.includes('AND account_id = ?')) {
		const v = args[i++];
		out = out.filter((r) => r.account_id === v);
	} else if (sql.includes(`AND ${o.walletSql} = ?`)) {
		const v = args[i++];
		out = out.filter((r) => r.wallet_id === v);
	}
	return out;
}

const dbExecute = vi.hoisted(() => vi.fn());

vi.mock('@/lib/db', () => ({ db: { execute: (stmt: { sql: string; args?: unknown[] }) => dbExecute(stmt) } }));
vi.mock('@/lib/requireTenantSession', () => ({ requireTenantSession: async () => state.session }));
vi.mock('@/lib/subscriptions', () => ({ getActivePlan: async () => ({ id: state.plan }) }));

function answer(stmt: string | { sql: string; args?: unknown[] }) {
	const sql = typeof stmt === 'string' ? stmt : stmt.sql;
	const args = typeof stmt === 'string' ? [] : stmt.args ?? [];
	state.calls.push({ sql, args });
	// The row cap counts each half first (SELECT COUNT(*) AS n, same FROM and WHERE); pg returns
	// a count as text.
	const isCount = /^SELECT COUNT\(\*\) AS n FROM /.test(sql);
	const rows = (r: Row[]) => ({ rows: isCount ? [{ n: String(r.length) }] : r, rowsAffected: 0 });
	if (/information_schema\.columns/.test(sql)) return rows(IMPORT_COLUMNS.map((name) => ({ name })));
	if (/CREATE TABLE IF NOT EXISTS wallet_identity/.test(sql)) return rows([]);
	if (/FROM wallets w WHERE w\.id = \? AND w\.tenant_id = \?/.test(sql)) {
		return rows(fx.wallets.filter((w) => w.id === args[0] && w.tenant_id === args[1]));
	}
	if (/FROM wallets w WHERE w\.tenant_id = \?/.test(sql)) return rows(fx.wallets.filter((w) => w.tenant_id === args[0]));
	if (/FROM exchange_accounts ea WHERE ea\.tenant_id = \?/.test(sql)) return rows(fx.accounts.filter((a) => a.tenant_id === args[0]));
	if (/FROM wallet_identity wi WHERE wi\.tenant_id = \?/.test(sql)) return rows(state.identity.filter((r) => r.tenant_id === args[0]));
	if (/FROM address_labels al/.test(sql)) return rows(fx.labels.filter((l) => l.tenant_id === args[0]));
	if (/FROM import_transactions/.test(sql)) {
		return rows(filterRows(fx.imports, sql, args, { timeSql: 'timestamp_utc', walletSql: 'wallet_id', dupSql: 'is_duplicate', dupField: 'is_duplicate' }));
	}
	if (/FROM transactions t/.test(sql)) {
		const base = filterRows(fx.onchain, sql, args, { timeSql: 't.timestamp', walletSql: 't.wallet_id', dupSql: 't.is_duplicate', dupField: 'is_duplicate' });
		return rows(
			base.map((t) => {
				const w = fx.wallets.find((x) => x.id === t.wallet_id && x.tenant_id === t.tenant_id);
				const a = fx.annotations.find((x) => x.transaction_id === t.id && x.tenant_id === t.tenant_id);
				return { ...t, wallet_address: w?.address ?? null, annotation_note: a?.note ?? null, annotation_category: a?.category ?? null };
			}),
		);
	}
	if (/FROM sui_transactions s/.test(sql)) {
		return rows(filterRows(fx.sui, sql, args, { timeSql: 's.timestamp', walletSql: 's.wallet_id' }));
	}
	throw new Error(`unexpected SQL: ${sql}`);
}

import { OWNER_TENANT_ID } from '../../src/lib/owner';
import { DEMO_TENANT_ID } from '../../src/lib/demo';
import { GET as historyGET } from '../../src/pages/api/records/history-by-wallet';
import { GET as exportGET } from '../../src/pages/api/transactions/export';
import { en, es, fr } from '../../src/i18n/historyExport';
import { MAX_HISTORY_ROWS } from '../../src/lib/historyRows';

const call = async (handler: typeof historyGET, path: string, lang?: string) => {
	const headers: Record<string, string> = {};
	if (lang) headers.cookie = `almstins-lang=${lang}`;
	const request = new Request(`https://almstins.test${path}`, { headers });
	return handler({ request, url: new URL(request.url) } as never) as Promise<Response>;
};

/** Minimal RFC 4180 reader: quotes, doubled quotes, CRLF. Drops the BOM. */
function parseCsv(text: string): string[][] {
	const s = text.replace(/^﻿/, '');
	const out: string[][] = [];
	let row: string[] = [];
	let cell = '';
	let quoted = false;
	for (let i = 0; i < s.length; i++) {
		const ch = s[i];
		if (quoted) {
			if (ch === '"' && s[i + 1] === '"') { cell += '"'; i++; }
			else if (ch === '"') quoted = false;
			else cell += ch;
		} else if (ch === '"') quoted = true;
		else if (ch === ',') { row.push(cell); cell = ''; }
		else if (ch === '\r' && s[i + 1] === '\n') { row.push(cell); out.push(row); row = []; cell = ''; i++; }
		else cell += ch;
	}
	if (cell || row.length) { row.push(cell); out.push(row); }
	return out;
}

async function unzip(res: Response): Promise<Record<string, string>> {
	const zip = await JSZip.loadAsync(await res.arrayBuffer());
	const files: Record<string, string> = {};
	for (const name of Object.keys(zip.files)) {
		if (!zip.files[name].dir) files[name] = await zip.files[name].async('string');
	}
	return files;
}

const HEADER = en.file.columns;
const col = (name: keyof typeof HEADER) => Object.keys(HEADER).indexOf(name);
const PLAIN = en.file.plainColumns;
const pcol = (name: keyof typeof PLAIN) => Object.keys(PLAIN).indexOf(name);

beforeEach(() => {
	state.session = { tenantId: TENANT };
	state.plan = 'starter';
	state.calls = [];
	state.identity = [];
	dbExecute.mockReset();
	dbExecute.mockImplementation(async (stmt) => answer(stmt));
	vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
	vi.restoreAllMocks();
});

// ── Tenant isolation ─────────────────────────────────────────────────────────

type Join = { kind: 'LEFT' | 'INNER'; alias: string; on: string; rest: string };
function joinsIn(sql: string): Join[] {
	const out: Join[] = [];
	for (const m of sql.matchAll(/\b(LEFT\s+(?:OUTER\s+)?)?JOIN\s+(\w+)\s+(?:AS\s+)?(\w+)\s+ON\s+/gi)) {
		const after = sql.slice(m.index! + m[0].length);
		const end = after.search(/\b(?:(?:LEFT\s+(?:OUTER\s+)?)?JOIN|WHERE|GROUP\s+BY|ORDER\s+BY|LIMIT)\b/i);
		out.push({ kind: m[1] ? 'LEFT' : 'INNER', alias: m[3], on: end === -1 ? after : after.slice(0, end), rest: after });
	}
	return out;
}

const dataCalls = () => state.calls.filter((c) => !/information_schema|CREATE TABLE/.test(c.sql));

describe('tenant isolation', () => {
	it('every query of the ZIP build is scoped by the session tenant, and every JOIN matches within it', async () => {
		const res = await call(historyGET, '/api/records/history-by-wallet');
		expect(res.status).toBe(200);
		const calls = dataCalls();
		expect(calls.length).toBeGreaterThanOrEqual(7); // imports, on-chain, Sui, wallets, accounts, identity, labels
		for (const c of calls) {
			expect(c.sql, c.sql).toMatch(/\btenant_id = \?/);
			expect(c.args[0], c.sql).toBe(TENANT);
			for (const j of joinsIn(c.sql)) {
				const pred = new RegExp(`\\b${j.alias}\\.tenant_id\\s*=`);
				expect(pred.test(j.kind === 'LEFT' ? j.on : j.rest), `${c.sql}\nJOIN ${j.alias}`).toBe(true);
			}
		}
		expect(calls.some((c) => joinsIn(c.sql).length >= 2)).toBe(true);
	});

	it("another tenant's rows, notes and labels never reach the files", async () => {
		const files = await unzip(await call(historyGET, '/api/records/history-by-wallet'));
		const all = Object.values(files).join('\n');
		for (const leak of ['SECRET', 'LEAKED', 'Not yours', 'Their account', ACCT_OTHER]) expect(all).not.toContain(leak);
	});

	it('the plain export refuses a wallet id that belongs to another tenant', async () => {
		const res = await call(exportGET, '/api/transactions/export?walletId=w-other');
		expect(res.status).toBe(404);
		expect(dataCalls().filter((c) => /FROM (import_transactions|transactions t|sui_transactions)/.test(c.sql))).toEqual([]);
	});

	it('the tenant comes from the session only: a tenantId in the query is ignored', async () => {
		const res = await call(historyGET, `/api/records/history-by-wallet?tenantId=${OTHER}&tenant_id=${OTHER}`);
		expect(res.status).toBe(200);
		for (const c of dataCalls()) expect(c.args[0]).toBe(TENANT);
	});
});

// ── Gating ───────────────────────────────────────────────────────────────────

describe('history by wallet: paid plans and the owner', () => {
	it('signed out gets 401', async () => {
		state.session = null;
		const res = await call(historyGET, '/api/records/history-by-wallet');
		expect(res.status).toBe(401);
		expect(dataCalls()).toEqual([]);
	});

	it('a Free account gets the paid-plan answer as JSON, before any data is read', async () => {
		state.plan = 'free';
		const res = await call(historyGET, '/api/records/history-by-wallet');
		expect(res.status).toBe(403);
		expect(res.headers.get('Content-Type')).toMatch(/application\/json/);
		expect(res.headers.get('Cache-Control')).toBe('no-store');
		const body = await res.json();
		expect(body).toMatchObject({ planRequired: 'paid', currentPlan: 'free' });
		expect(state.calls).toEqual([]);
	});

	it('an unknown plan id is treated as free (fail-closed)', async () => {
		state.plan = 'enterprise-trial';
		expect((await call(historyGET, '/api/records/history-by-wallet')).status).toBe(403);
	});

	it.each(['starter', 'pro', 'unlimited'])('the %s plan gets the ZIP, no-store', async (plan) => {
		state.plan = plan;
		const res = await call(historyGET, '/api/records/history-by-wallet');
		expect(res.status).toBe(200);
		expect(res.headers.get('Content-Type')).toBe('application/zip');
		expect(res.headers.get('Cache-Control')).toBe('no-store');
		expect(res.headers.get('Content-Disposition')).toBe('attachment; filename="almstins-history-by-wallet-all-years.zip"');
	});

	it('the owner gets the ZIP on any plan', async () => {
		state.session = { tenantId: OWNER_TENANT_ID };
		state.plan = 'free';
		expect((await call(historyGET, '/api/records/history-by-wallet')).status).toBe(200);
	});

	it('a demo session follows the demo tenant plan, like the other paid downloads', async () => {
		state.session = { tenantId: DEMO_TENANT_ID, isDemo: true };
		state.plan = 'free';
		expect((await call(historyGET, '/api/records/history-by-wallet')).status).toBe(403);
		state.plan = 'unlimited';
		expect((await call(historyGET, '/api/records/history-by-wallet')).status).toBe(200);
	});

	it.each(['20x5', '1999', '3000', 'all', '2025.0'])('?year=%s is a 400', async (year) => {
		const res = await call(historyGET, `/api/records/history-by-wallet?year=${year}`);
		expect(res.status).toBe(400);
	});

	it('a database failure is a plain 500, no error text', async () => {
		dbExecute.mockImplementation(async (stmt: { sql: string }) => {
			if (/FROM transactions t/.test(stmt.sql)) throw new Error('password authentication failed for user "secret_user"');
			return answer(stmt);
		});
		const res = await call(historyGET, '/api/records/history-by-wallet');
		expect(res.status).toBe(500);
		expect(await res.text()).not.toMatch(/secret_user|password/);
	});
});

describe('the plain CSV answers on every plan', () => {
	it.each(['free', 'starter', 'unlimited'])('%s', async (plan) => {
		state.plan = plan;
		const res = await call(exportGET, '/api/transactions/export');
		expect(res.status).toBe(200);
		expect(res.headers.get('Content-Type')).toBe('text/csv; charset=utf-8');
		expect(res.headers.get('Cache-Control')).toBe('no-store');
		expect(res.headers.get('Content-Disposition')).toBe('attachment; filename="almstins-transactions.csv"');
	});
});

// ── The ZIP ──────────────────────────────────────────────────────────────────

describe('the ZIP', () => {
	it('holds all-wallets.csv, wallets.csv and one file per wallet, with safe names', async () => {
		const files = await unzip(await call(historyGET, '/api/records/history-by-wallet'));
		const names = Object.keys(files).sort();
		expect(names).toContain('all-wallets.csv');
		expect(names).toContain('wallets.csv');
		const perWallet = names.filter((n) => n.startsWith('wallets/'));
		// Crypto.com #1, #2, unassigned; BTC; Main on Ethereum and on Polygon; Sui
		expect(perWallet).toHaveLength(7);
		for (const n of perWallet) {
			expect(n).toMatch(/^wallets\/\d{2}-[a-z0-9-]{1,40}\.csv$/);
			for (const raw of [ACCT1, ACCT2, ACCT_BTC, EVM, SUI, BTC, 'w-evm']) expect(n).not.toContain(raw.toLowerCase());
		}
	});

	it('every file uses the 20 columns, in order, with the transfer columns blank', async () => {
		const files = await unzip(await call(historyGET, '/api/records/history-by-wallet'));
		for (const [name, text] of Object.entries(files)) {
			if (name === 'wallets.csv') continue;
			const rows = parseCsv(text);
			expect(rows[0], name).toEqual(Object.values(HEADER));
			for (const r of rows.slice(1)) {
				expect(r, name).toHaveLength(20);
				expect(r[col('transferId')]).toBe('');
				expect(r[col('transferOtherWallet')]).toBe('');
			}
		}
	});

	it('never includes cost basis, gain, loss, lot or holding-period columns', async () => {
		const files = await unzip(await call(historyGET, '/api/records/history-by-wallet'));
		const header = parseCsv(files['all-wallets.csv'])[0].join(' ');
		expect(header).not.toMatch(/basis|gain|loss|lot\b|holding|proceeds|term/i);
	});

	it('all-wallets.csv is sorted by owner, then wallet, then time, and holds every row once', async () => {
		const files = await unzip(await call(historyGET, '/api/records/history-by-wallet'));
		const rows = parseCsv(files['all-wallets.csv']).slice(1);
		// i1, i2, i3, i4, i6, t1, t2, t3, s1 (i5 and i7 duplicates, t4 duplicate, s2 empty, other tenant out)
		expect(rows).toHaveLength(9);
		const wallets = rows.map((r) => r[col('wallet')]);
		const order = [...new Set(wallets)];
		expect(order).toEqual([
			'Cold BTC · Bitcoin',
			'Crypto.com · Account #1',
			'Crypto.com · Account #2',
			'Crypto.com (unassigned)',
			'Main · Ethereum',
			'Main · Polygon',
			'Sui One · Sui',
		]);
		// Grouped: each wallet's rows are contiguous, in time order.
		for (const w of order) {
			const idx = wallets.flatMap((x, i) => (x === w ? [i] : []));
			expect(idx[idx.length - 1] - idx[0] + 1, w).toBe(idx.length);
			const dates = idx.map((i) => rows[i][col('date')]);
			expect([...dates].sort(), w).toEqual(dates);
		}
		const per = Object.entries(files).filter(([n]) => n.startsWith('wallets/'));
		expect(per.reduce((n, [, t]) => n + parseCsv(t).length - 1, 0)).toBe(rows.length);
	});

	it('owners that are set come first, and a label set in wallet_identity replaces the default', async () => {
		state.identity = [
			{ tenant_id: TENANT, wallet_key: `cex:crypto_com:${ACCT2}`, label: 'Spouse CDC', owner_label: 'Spouse' },
			{ tenant_id: OTHER, wallet_key: `cex:crypto_com:${ACCT1}`, label: 'HIJACK', owner_label: 'Mallory' },
		];
		const files = await unzip(await call(historyGET, '/api/records/history-by-wallet'));
		const rows = parseCsv(files['all-wallets.csv']).slice(1);
		expect(rows[0][col('wallet')]).toBe('Spouse CDC');
		expect(rows[0][col('owner')]).toBe('Spouse');
		expect(rows.find((r) => r[col('wallet')] === 'Crypto.com · Account #1')?.[col('owner')]).toBe('Owner not set');
		expect(Object.values(files).join('\n')).not.toMatch(/HIJACK|Mallory/);
		expect(Object.keys(files)).toContain('wallets/01-spouse-cdc.csv');
	});

	it('a set owner label appears in every file of the ZIP and in the plain CSV; an empty one shows Owner not set', async () => {
		state.identity = [
			{ tenant_id: TENANT, wallet_key: `cex:crypto_com:${ACCT1}`, label: null, owner_label: 'Me' },
			{ tenant_id: TENANT, wallet_key: `cex:crypto_com:${ACCT2}`, label: null, owner_label: 'Spouse' },
			{ tenant_id: TENANT, wallet_key: `bitcoin:${BTC}`, label: null, owner_label: null },
		];
		const files = await unzip(await call(historyGET, '/api/records/history-by-wallet'));
		const rows = parseCsv(files['all-wallets.csv']).slice(1);
		const ownerOf = (key: string) => [...new Set(rows.filter((r) => r[col('walletKey')] === key).map((r) => r[col('owner')]))];
		expect(ownerOf(`cex:crypto_com:${ACCT1}`)).toEqual(['Me']);
		expect(ownerOf(`cex:crypto_com:${ACCT2}`)).toEqual(['Spouse']);
		expect(ownerOf(`bitcoin:${BTC}`)).toEqual(['Owner not set']);
		expect(ownerOf('cex:crypto_com:unassigned')).toEqual(['Owner not set']);
		// Owners that are set come first: Me, then Spouse, then the rest.
		expect([...new Set(rows.map((r) => r[col('owner')]))]).toEqual(['Me', 'Spouse', 'Owner not set']);
		const spouseFile = Object.keys(files).find((n) => /^wallets\/\d+-crypto-com-account-2\.csv$/.test(n))!;
		expect(parseCsv(files[spouseFile]).slice(1).map((r) => r[col('owner')])).toEqual(['Spouse']);
		const index = parseCsv(files['wallets.csv']);
		expect(index.find((l) => l[0] === `cex:crypto_com:${ACCT2}`)?.[2]).toBe('Spouse');
		expect(index.find((l) => l[0] === `bitcoin:${BTC}`)?.[2]).toBe('Owner not set');

		const plain = parseCsv(await (await call(exportGET, '/api/transactions/export')).text());
		expect(plain[0][pcol('owner')]).toBe('Owner');
		const body = plain.slice(1);
		const plainOwner = (asset: string, amount: string) => body.find((r) => r[pcol('asset')] === asset && r[pcol('amount')] === amount)?.[pcol('owner')];
		expect(plainOwner('CRO', '100')).toBe('Me'); // i1, account 1
		expect(plainOwner('ETH', '0.5')).toBe('Spouse'); // i2, account 2
		expect(plainOwner('BTC', '0.01')).toBe('Owner not set');
		expect(body.find((r) => r[pcol('asset')] === 'SUI')?.[pcol('owner')]).toBe('Owner not set');
		// The plain export reads owners for this tenant only.
		const idCall = state.calls.filter((c) => /FROM wallet_identity wi/.test(c.sql)).pop()!;
		expect(idCall.args).toEqual([TENANT]);
	});

	it('the owner of an address shows on every chain of it, even one saved only on another key', async () => {
		state.identity = [{ tenant_id: TENANT, wallet_key: `ethereum:${EVM}`, label: null, owner_label: 'Spouse' }];
		const files = await unzip(await call(historyGET, '/api/records/history-by-wallet'));
		const rows = parseCsv(files['all-wallets.csv']).slice(1);
		const main = rows.filter((r) => r[col('wallet')].startsWith('Main'));
		expect(new Set(main.map((r) => r[col('walletKey')]))).toEqual(new Set([`ethereum:${EVM}`, `polygon:${EVM}`]));
		expect(new Set(main.map((r) => r[col('owner')]))).toEqual(new Set(['Spouse']));
		// Another tenant's owner on the same key never applies.
		state.identity = [{ tenant_id: OTHER, wallet_key: `ethereum:${EVM}`, label: null, owner_label: 'Mallory' }];
		const again = parseCsv((await unzip(await call(historyGET, '/api/records/history-by-wallet')))['all-wallets.csv']).slice(1);
		expect(again.some((r) => r[col('owner')] === 'Mallory')).toBe(false);
	});

	it('an account named after its exchange reads "Crypto.com", not "Crypto.com · Crypto.com"', async () => {
		const ACCT_SAME = '55555555-5555-4555-8555-555555555555';
		fx.accounts.push({ id: ACCT_SAME, tenant_id: TENANT, source: 'crypto_com', name: ' crypto.com ' });
		fx.imports.push({
			id: 'i-same', tenant_id: TENANT, source: 'crypto_com', account_id: ACCT_SAME, wallet_id: null, timestamp_utc: '2025-09-01 00:00:00',
			asset_symbol: 'CRO', amount: 1, direction: 'in', is_duplicate: 0,
		});
		try {
			const files = await unzip(await call(historyGET, '/api/records/history-by-wallet'));
			const rows = parseCsv(files['all-wallets.csv']).slice(1);
			expect(rows.find((r) => r[col('walletKey')] === `cex:crypto_com:${ACCT_SAME}`)?.[col('wallet')]).toBe('Crypto.com');
			expect(rows.find((r) => r[col('walletKey')] === `cex:crypto_com:${ACCT2}`)?.[col('wallet')]).toBe('Crypto.com · Account #2');
		} finally {
			fx.accounts.pop();
			fx.imports.pop();
		}
	});

	it('one EVM address on two chains is two wallets with two keys', async () => {
		const files = await unzip(await call(historyGET, '/api/records/history-by-wallet'));
		const rows = parseCsv(files['all-wallets.csv']).slice(1);
		const keys = new Set(rows.filter((r) => r[col('wallet')].startsWith('Main')).map((r) => r[col('walletKey')]));
		expect([...keys].sort()).toEqual([`ethereum:${EVM}`, `polygon:${EVM}`]);
	});

	it('imported rows with no account land in the unassigned bucket, flagged in the index', async () => {
		const files = await unzip(await call(historyGET, '/api/records/history-by-wallet'));
		const rows = parseCsv(files['all-wallets.csv']).slice(1);
		const u = rows.filter((r) => r[col('walletKey')] === 'cex:crypto_com:unassigned');
		expect(u).toHaveLength(1);
		expect(u[0][col('wallet')]).toBe('Crypto.com (unassigned)');
		expect(u[0][col('accountType')]).toBe('Unassigned');
		expect(files['wallets.csv']).toContain(en.file.notes.unassigned);
	});

	it('exchange accounts are named by the account, chain-synced imports key on the wallet address', async () => {
		const files = await unzip(await call(historyGET, '/api/records/history-by-wallet'));
		const rows = parseCsv(files['all-wallets.csv']).slice(1);
		const two = rows.find((r) => r[col('walletKey')] === `cex:crypto_com:${ACCT2}`)!;
		expect(two[col('wallet')]).toBe('Crypto.com · Account #2');
		expect(two[col('accountType')]).toBe('Exchange account');
		expect(two[col('addressOrAccount')]).toBe('Account #2');
		expect(two[col('amount')]).toBe('0.5');
		expect(two[col('usdValue')]).toBe('1500');
		expect([two[col('fee')], two[col('feeAsset')]]).toEqual(['0.001', 'ETH']);
		expect(two[col('notes')]).toBe('to cold');
		const btc = rows.find((r) => r[col('asset')] === 'BTC')!;
		expect(btc[col('walletKey')]).toBe(`bitcoin:${BTC}`);
		expect(btc[col('accountType')]).toBe('On-chain wallet');
		expect(btc[col('chain')]).toBe('Bitcoin');
	});

	it('on-chain rows: raw amounts converted, fee only when the wallet sent, counterparty labeled, failed moves nothing', async () => {
		const files = await unzip(await call(historyGET, '/api/records/history-by-wallet'));
		const rows = parseCsv(files['all-wallets.csv']).slice(1);
		const t1 = rows.find((r) => r[col('txHash')] === '0x' + '1'.repeat(64))!;
		expect([t1[col('direction')], t1[col('asset')], t1[col('amount')], t1[col('usdValue')]]).toEqual(['out', 'ETH', '1.5', '3000']);
		expect([t1[col('fee')], t1[col('feeAsset')]]).toEqual(['0.000021', 'ETH']);
		expect(t1[col('counterparty')]).toBe(DEAD);
		expect(t1[col('counterpartyLabel')]).toBe("'@burn");
		expect(t1[col('date')]).toBe('2025-01-15 08:00:00');
		const t2 = rows.find((r) => r[col('txHash')] === '0x' + '2'.repeat(64))!;
		expect([t2[col('direction')], t2[col('asset')], t2[col('amount')], t2[col('fee')]]).toEqual(['in', 'USDC', '2.5', '']);
		expect([t2[col('category')], t2[col('notes')], t2[col('chain')]]).toEqual(['income', 'payment', 'Polygon']);
		const t3 = rows.find((r) => r[col('txHash')] === '0x' + '3'.repeat(64))!;
		expect([t3[col('amount')], t3[col('usdValue')], t3[col('fee')]]).toEqual(['0', '', '0.000001']);
		expect(t3[col('notes')]).toBe(en.file.failedTx);
	});

	it('Sui is included; an empty Sui row is not', async () => {
		const files = await unzip(await call(historyGET, '/api/records/history-by-wallet'));
		const rows = parseCsv(files['all-wallets.csv']).slice(1);
		const sui = rows.filter((r) => r[col('chain')] === 'Sui');
		expect(sui).toHaveLength(1);
		// The balance went down by 1 SUI, gas included: 0.998 sent plus a 0.002 fee, gas counted once.
		expect([sui[0][col('direction')], sui[0][col('amount')], sui[0][col('fee')], sui[0][col('feeAsset')], sui[0][col('txHash')]]).toEqual([
			'out', '0.998', '0.002', 'SUI', 'Dig1',
		]);
		expect(sui[0][col('walletKey')]).toBe(`sui:${SUI}`);
	});

	it('rows flagged as duplicates (1 = flagged, 2 = confirmed) are skipped, with the predicate in SQL', async () => {
		const files = await unzip(await call(historyGET, '/api/records/history-by-wallet'));
		const text = files['all-wallets.csv'];
		expect(text).not.toContain('USDC,5'); // i7, confirmed duplicate
		expect(text).not.toContain('0x' + '4'.repeat(64)); // t4
		const cro = parseCsv(text).slice(1).filter((r) => r[col('asset')] === 'CRO' && r[col('amount')] === '100');
		expect(cro).toHaveLength(1); // i1, not its duplicate i5
		const imp = state.calls.find((c) => /FROM import_transactions/.test(c.sql))!.sql;
		const onc = state.calls.find((c) => /FROM transactions t/.test(c.sql))!.sql;
		expect(imp).toContain('(is_duplicate IS NULL OR is_duplicate = 0 OR is_duplicate = -1)');
		expect(onc).toContain('(t.is_duplicate IS NULL OR t.is_duplicate = 0 OR t.is_duplicate = -1)');
	});

	it('?year= keeps that calendar year only, in every half', async () => {
		const res = await call(historyGET, '/api/records/history-by-wallet?year=2024');
		expect(res.headers.get('Content-Disposition')).toContain('almstins-history-by-wallet-2024.zip');
		const files = await unzip(res);
		const rows = parseCsv(files['all-wallets.csv']).slice(1);
		expect(rows.map((r) => r[col('amount')])).toEqual(['7']);
		for (const re of [/FROM import_transactions/, /FROM transactions t/, /FROM sui_transactions s/]) {
			const c = state.calls.find((x) => re.test(x.sql))!;
			expect(c.args).toEqual([TENANT, '2024-01-01', '2025-01-01']);
		}
		expect(files['wallets.csv']).toContain('Period: 2024.');
	});

	it('wallets.csv: header note, then one line per wallet with dates, count and file', async () => {
		const files = await unzip(await call(historyGET, '/api/records/history-by-wallet'));
		const lines = parseCsv(files['wallets.csv']);
		expect(lines[0]).toEqual([en.file.notes.copyLine]);
		expect(lines[1][0]).toMatch(/^Generated \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} \(UTC\)\. Period: all years\.$/);
		expect(files['wallets.csv']).toContain(en.file.notes.transfers);
		expect(files['wallets.csv']).toContain(en.file.notes.duplicates);
		expect(files['wallets.csv']).not.toContain(en.file.notes.lost);
		const h = lines.findIndex((l) => l[0] === en.file.indexColumns.walletKey);
		expect(lines[h]).toEqual(Object.values(en.file.indexColumns));
		const main = lines.slice(h + 1).find((l) => l[0] === `ethereum:${EVM}`)!;
		expect(main).toEqual([
			`ethereum:${EVM}`, 'Main · Ethereum', 'Owner not set', 'On-chain wallet', EVM, '2025-01-15 08:00:00', '2025-01-25 08:00:00', '2',
			main[8],
		]);
		expect(Object.keys(files)).toContain(main[8]);
		expect(lines.slice(h + 1)).toHaveLength(7);
	});

	it('a row the exchange file marked lost keeps that direction in both files, and the index explains it', async () => {
		fx.imports.push({
			id: 'i-lost', tenant_id: TENANT, source: 'crypto_com', account_id: ACCT1, wallet_id: null, timestamp_utc: '2025-08-01 00:00:00',
			asset_symbol: 'CRO', currency: 'CRO', amount: -3, direction: 'lost', kind: 'lost', is_duplicate: 0,
		});
		try {
			const files = await unzip(await call(historyGET, '/api/records/history-by-wallet'));
			const row = parseCsv(files['all-wallets.csv']).slice(1).find((r) => r[col('date')] === '2025-08-01 00:00:00')!;
			expect([row[col('direction')], row[col('asset')], row[col('amount')]]).toEqual(['lost', 'CRO', '3']);
			expect(files['wallets.csv']).toContain(en.file.notes.lost);
			const plain = parseCsv(await (await call(exportGET, '/api/transactions/export')).text()).slice(1);
			const p = plain.find((r) => r[pcol('date')] === '2025-08-01 00:00:00')!;
			expect([p[pcol('direction')], p[pcol('asset')], p[pcol('amount')]]).toEqual(['lost', 'CRO', '3']);
		} finally {
			fx.imports.pop();
		}
	});

	it('is written in the language of the session (ES, FR)', async () => {
		const esFiles = await unzip(await call(historyGET, '/api/records/history-by-wallet', 'es'));
		expect(parseCsv(esFiles['all-wallets.csv'])[0]).toEqual(Object.values(es.file.columns));
		expect(esFiles['all-wallets.csv']).toContain('Propietario sin indicar');
		expect(esFiles['all-wallets.csv']).toContain('Crypto.com (sin asignar)');
		const frFiles = await unzip(await call(historyGET, '/api/records/history-by-wallet', 'fr'));
		expect(parseCsv(frFiles['wallets.csv'])[0]).toEqual([fr.file.notes.copyLine]);
		expect(frFiles['all-wallets.csv']).toContain('Propriétaire non indiqué');
	});
});

// ── Formula escaping ─────────────────────────────────────────────────────────

describe('every cell is protected against spreadsheet formulas', () => {
	it('an on-chain token symbol that is a formula is written as text', async () => {
		const files = await unzip(await call(historyGET, '/api/records/history-by-wallet'));
		expect(files['all-wallets.csv']).toContain(`"'=HYPERLINK(""http://x.test"",""y"")"`);
		const plain = await (await call(exportGET, '/api/transactions/export')).text();
		expect(plain).toContain(`"'=HYPERLINK(""http://x.test"",""y"")"`);
	});

	it('no cell in any file starts with = + - @, a tab or a carriage return', async () => {
		state.identity = [
			{ tenant_id: TENANT, wallet_key: `cex:crypto_com:${ACCT1}`, label: '+SUM(A1)', owner_label: '-1+2' },
			{ tenant_id: TENANT, wallet_key: `ethereum:${EVM}`, label: '\tcmd', owner_label: '\r=evil' },
		];
		const files = await unzip(await call(historyGET, '/api/records/history-by-wallet'));
		const plain = await (await call(exportGET, '/api/transactions/export')).text();
		for (const [name, text] of [...Object.entries(files), ['plain.csv', plain]]) {
			for (const row of parseCsv(text)) {
				for (const cell of row) expect(cell, `${name}: ${JSON.stringify(cell)}`).not.toMatch(/^[=+\-@\t\r]/);
			}
		}
		expect(files['all-wallets.csv']).toContain("'+SUM(A1)");
		expect(files['all-wallets.csv']).toContain("'-1+2");
	});
});

// ── The plain CSV ────────────────────────────────────────────────────────────

describe('the plain CSV', () => {
	it('has an Owner column but no wallet or label columns, and keeps every half in time order', async () => {
		const text = await (await call(exportGET, '/api/transactions/export')).text();
		const rows = parseCsv(text);
		expect(rows[0]).toEqual(Object.values(en.file.plainColumns));
		expect(rows[0].slice(0, 3)).toEqual(['Date (UTC)', 'Source', 'Owner']);
		expect(rows[0].join(' ')).not.toMatch(/Wallet|label/i);
		const body = rows.slice(1);
		expect(body).toHaveLength(9);
		const dates = body.map((r) => r[pcol('date')]);
		expect([...dates].sort()).toEqual(dates);
		expect(body.map((r) => r[pcol('source')])).toEqual(expect.arrayContaining(['Crypto.com', 'Ethereum', 'Polygon', 'Bitcoin', 'Sui']));
		expect(new Set(body.map((r) => r[pcol('owner')]))).toEqual(new Set(['Owner not set']));
		expect(text).not.toContain('@burn');
		expect(text).not.toContain('Account #2');
	});

	it('?walletId= of an on-chain wallet filters every half by wallet_id', async () => {
		const res = await call(exportGET, '/api/transactions/export?walletId=w-btc');
		expect(res.status).toBe(200);
		expect(res.headers.get('Content-Disposition')).toBe('attachment; filename="almstins-transactions-cold-btc.csv"');
		const imp = state.calls.find((c) => /FROM import_transactions/.test(c.sql))!;
		const onc = state.calls.find((c) => /FROM transactions t/.test(c.sql))!;
		const sui = state.calls.find((c) => /FROM sui_transactions s/.test(c.sql))!;
		expect(imp.sql).toMatch(/AND wallet_id = \?/);
		expect(imp.args).toEqual([TENANT, 'w-btc']);
		expect(onc.sql).toMatch(/AND t\.wallet_id = \?/);
		expect(onc.args).toEqual([TENANT, 'w-btc']);
		expect(sui.sql).toMatch(/AND s\.wallet_id = \?/);
		expect(sui.args).toEqual([TENANT, 'w-btc']);
		const rows = parseCsv(await res.text()).slice(1);
		expect(rows.map((r) => r[pcol('asset')])).toEqual(['BTC']);
	});

	it('?walletId= of an EVM wallet returns only its on-chain rows, no exchange rows', async () => {
		const res = await call(exportGET, '/api/transactions/export?walletId=w-evm');
		const rows = parseCsv(await res.text()).slice(1);
		expect(rows.map((r) => r[pcol('source')]).sort()).toEqual(['Ethereum', 'Ethereum', 'Polygon']);
		expect(res.headers.get('Content-Disposition')).not.toContain('w-evm');
	});

	it("?walletId= of an exchange account's wallet selects that account's imported rows only", async () => {
		const res = await call(exportGET, '/api/transactions/export?walletId=w-mirror');
		const rows = parseCsv(await res.text()).slice(1);
		expect(rows.map((r) => r[pcol('asset')])).toEqual(['CRO', 'CRO']); // i6 (2024) and i1; not i5 (duplicate)
		const imp = state.calls.find((c) => /FROM import_transactions/.test(c.sql))!;
		expect(imp.sql).toMatch(/AND account_id = \?/);
		expect(imp.args).toEqual([TENANT, ACCT1]);
		expect(state.calls.some((c) => /FROM transactions t|FROM sui_transactions/.test(c.sql))).toBe(false);
	});

	it('an empty walletId is a 400, not the whole history', async () => {
		expect((await call(exportGET, '/api/transactions/export?walletId=')).status).toBe(400);
	});
});

// ── Size and concurrency ─────────────────────────────────────────────────────

const rowReads = () =>
	state.calls.filter((c) => !/^SELECT COUNT/.test(c.sql) && /FROM (import_transactions|transactions t|sui_transactions)/.test(c.sql));

describe('a history too large for one file is refused before it is loaded', () => {
	/** The imported half counts `n`; the others count their fixtures (3 on-chain + 2 Sui). */
	const importsCount = (n: number) =>
		dbExecute.mockImplementation(async (stmt: { sql: string; args?: unknown[] }) => {
			if (/^SELECT COUNT\(\*\) AS n FROM import_transactions /.test(stmt.sql)) {
				state.calls.push({ sql: stmt.sql, args: stmt.args ?? [] });
				return { rows: [{ n: String(n) }], rowsAffected: 0 };
			}
			return answer(stmt);
		});

	it.each([
		['the ZIP', '/api/records/history-by-wallet'],
		['the plain CSV', '/api/transactions/export'],
	] as const)('%s: more rows than the cap is a JSON 413, and no row is read', async (_name, path) => {
		importsCount(MAX_HISTORY_ROWS);
		const res = await call(path.includes('records') ? historyGET : exportGET, path);
		expect(res.status).toBe(413);
		expect(res.headers.get('Content-Type')).toMatch(/application\/json/);
		expect(res.headers.get('Cache-Control')).toBe('no-store');
		expect(await res.json()).toMatchObject({ tooManyRows: true, limit: MAX_HISTORY_ROWS });
		expect(rowReads()).toEqual([]);
		// The counts use the same scope as the rows: the session tenant, duplicates left out.
		const counts = state.calls.filter((c) => /^SELECT COUNT/.test(c.sql));
		expect(counts).toHaveLength(3);
		for (const c of counts) {
			expect(c.args[0]).toBe(TENANT);
			expect(c.sql).toMatch(/tenant_id = \?/);
		}
	});

	it('exactly the cap is still built', async () => {
		importsCount(MAX_HISTORY_ROWS - 5);
		const res = await call(historyGET, '/api/records/history-by-wallet');
		expect(res.status).toBe(200);
		expect(rowReads().length).toBe(3);
	});

	it('a year is counted on its own', async () => {
		const res = await call(historyGET, '/api/records/history-by-wallet?year=2024');
		expect(res.status).toBe(200);
		const counts = state.calls.filter((c) => /^SELECT COUNT/.test(c.sql));
		for (const c of counts) expect(c.args).toEqual([TENANT, '2024-01-01', '2025-01-01']);
	});
});

describe('one file at a time for each account', () => {
	it('a second request while the first is being built is a JSON 429; the next one after it works', async () => {
		let release!: () => void;
		const gate = new Promise<void>((resolve) => (release = resolve));
		let building = false;
		dbExecute.mockImplementation(async (stmt: { sql: string; args?: unknown[] }) => {
			if (/^SELECT s\.id/.test(stmt.sql)) {
				building = true;
				await gate;
			}
			return answer(stmt);
		});
		const first = call(historyGET, '/api/records/history-by-wallet');
		await vi.waitFor(() => expect(building).toBe(true));

		const second = await call(historyGET, '/api/records/history-by-wallet');
		expect(second.status).toBe(429);
		expect(second.headers.get('Content-Type')).toMatch(/application\/json/);
		const plain = await call(exportGET, '/api/transactions/export');
		expect(plain.status).toBe(429);

		// Another account is not held up.
		state.session = { tenantId: OTHER };
		dbExecute.mockImplementation(async (stmt) => answer(stmt));
		expect((await call(exportGET, '/api/transactions/export')).status).toBe(200);
		state.session = { tenantId: TENANT };

		release();
		expect((await first).status).toBe(200);
		expect((await call(historyGET, '/api/records/history-by-wallet')).status).toBe(200);
	});

	it('a failed build frees the account for the next request', async () => {
		dbExecute.mockImplementation(async (stmt: { sql: string }) => {
			if (/FROM transactions t/.test(stmt.sql)) throw new Error('boom');
			return answer(stmt);
		});
		expect((await call(historyGET, '/api/records/history-by-wallet')).status).toBe(500);
		dbExecute.mockImplementation(async (stmt) => answer(stmt));
		expect((await call(historyGET, '/api/records/history-by-wallet')).status).toBe(200);
	});
});
