import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * GET /api/address-history?address=...: the signed-in user's own transactions with one address.
 *
 *   - Signed out is a 401; an empty or overlong address is a 400; neither reads the database.
 *   - An exchange account id is not_onchain, without reading the database. No address is
 *     not_kept_yet any more: Litecoin history is imported too.
 *   - An EVM address: every query is scoped by the session's tenant and sends the address
 *     lowercased; the totals match the rows; the answer has exactly the planned fields.
 *   - A Bitcoin, Litecoin, Solana or Sui address: the tenant's imported and Sui rows whose stored
 *     counterparty_address is that address, in its stored form (base58 exactly as typed).
 *   - The address never reaches the logs, and nothing is cached.
 *
 * Hermetic: the session and the database are stubs. The database stub answers from in-memory
 * fixtures and applies the tenant and counterparty clauses the code sends.
 */

const TENANT = 'tenant-a';
const OTHER = 'tenant-b';
const MINE = '0xabcdef0123456789abcdef0123456789abcdef01';
const SECOND = '0x1111111111111111111111111111111111111111';
const SHOP = '0x000000000000000000000000000000000000beef';
const OTHERS_WALLET = '0x2222222222222222222222222222222222222222';
const BTC_PEER = 'bc1qpeerpeerpeerpeerpeerpeerpeerpeerpeer0';
const SOL_PEER = 'So1PeerMixedCase' + 'x'.repeat(28);
const SUI_PEER = '0x' + 'cd'.repeat(32);
const LTC_PEER = 'ltc1qpeerpeerpeerpeerpeerpeerpeerpeerpeer0';
const LTC_LEGACY_PEER = 'LPeerMixedCaseLegacy' + 'x'.repeat(14);

type Row = Record<string, unknown>;

const state = vi.hoisted(() => ({
	session: null as null | { tenantId: string; isDemo?: boolean },
	calls: [] as Array<{ sql: string; args: unknown[] }>,
	extraOnchain: [] as Array<Record<string, unknown>>,
	fail: false,
}));

const fx = {
	wallets: [
		{ id: 'w-main', tenant_id: TENANT, address: MINE, label: 'Main' },
		{ id: 'w-second', tenant_id: TENANT, address: SECOND, label: null },
		{ id: 'w-theirs', tenant_id: OTHER, address: OTHERS_WALLET, label: 'Theirs' },
	] as Row[],
	onchain: [
		// Paid the shop 500 USDC on Polygon, then 700, then a failed ETH send.
		{ id: 't1', tenant_id: TENANT, wallet_id: 'w-main', chain: 'polygon', hash: '0x' + '1'.repeat(64), timestamp: '2025-02-01T10:00:00.000Z', from_address: MINE, to_address: SHOP, value: '500000000', token_symbol: 'USDC', token_decimals: 6, tx_type: 'token_out', status: 'confirmed', usd_value: 500, is_duplicate: 0 },
		{ id: 't2', tenant_id: TENANT, wallet_id: 'w-main', chain: 'polygon', hash: '0x' + '2'.repeat(64), timestamp: '2026-09-30T18:22:05.000Z', from_address: MINE, to_address: SHOP.toUpperCase().replace('0X', '0x'), value: '700000000', token_symbol: 'USDC', token_decimals: 6, tx_type: 'token_out', status: 'confirmed', usd_value: 700, is_duplicate: 0 },
		{ id: 't3', tenant_id: TENANT, wallet_id: 'w-main', chain: 'ethereum', hash: '0x' + '3'.repeat(64), timestamp: '2025-05-01T00:00:00.000Z', from_address: MINE, to_address: SHOP, value: '1000000000000000000', token_symbol: 'native', token_decimals: 18, tx_type: 'outgoing', status: 'failed', fee_paid: '21000000000000', usd_value: 3000, is_duplicate: 0 },
		// The shop refunded 0.1 ETH, with no USD value stored.
		{ id: 't4', tenant_id: TENANT, wallet_id: 'w-main', chain: 'ethereum', hash: '0x' + '4'.repeat(64), timestamp: '2025-06-01T00:00:00.000Z', from_address: SHOP, to_address: MINE, value: '100000000000000000', token_symbol: 'native', token_decimals: 18, tx_type: 'incoming', status: 'confirmed', usd_value: null, is_duplicate: 0 },
		// Not with the shop.
		{ id: 't5', tenant_id: TENANT, wallet_id: 'w-main', chain: 'ethereum', hash: '0x' + '5'.repeat(64), timestamp: '2025-07-01T00:00:00.000Z', from_address: MINE, to_address: SECOND, value: '1', token_symbol: 'native', token_decimals: 18, tx_type: 'outgoing', status: 'confirmed', is_duplicate: 0 },
		// Another tenant paid the same shop.
		{ id: 't-other', tenant_id: OTHER, wallet_id: 'w-theirs', chain: 'polygon', hash: '0x' + '9'.repeat(64), timestamp: '2025-03-01T00:00:00.000Z', from_address: OTHERS_WALLET, to_address: SHOP, value: '999000000', token_symbol: 'SECRET', token_decimals: 6, tx_type: 'token_out', status: 'confirmed', usd_value: 999, is_duplicate: 0 },
	] as Row[],
	// Chain-synced imports with their counterparty_address (Bitcoin, Solana).
	imports: [
		{ id: 'i-btc', tenant_id: TENANT, source: 'bitcoin', account_id: 'a-btc', wallet_id: 'w-btc', timestamp_utc: '2025-08-01T00:00:00.000Z', asset_symbol: 'BTC', currency: 'BTC', amount: 0.002, direction: 'in', native_usd: 120, tx_hash: 'b'.repeat(64), counterparty_address: BTC_PEER },
		{ id: 'i-sol', tenant_id: TENANT, source: 'solana', account_id: 'a-sol', wallet_id: 'w-sol', timestamp_utc: '2025-09-01T00:00:00.000Z', asset_symbol: 'USDC', currency: 'USDC', amount: -25, direction: 'out', native_usd: null, tx_hash: 'SolSig1', counterparty_address: SOL_PEER },
		{ id: 'i-old', tenant_id: TENANT, source: 'bitcoin', account_id: 'a-btc', wallet_id: 'w-btc', timestamp_utc: '2024-01-01T00:00:00.000Z', asset_symbol: 'BTC', currency: 'BTC', amount: 1, direction: 'in', tx_hash: 'c'.repeat(64), counterparty_address: null },
		{ id: 'i-ltc-in', tenant_id: TENANT, source: 'litecoin', account_id: 'a-ltc', wallet_id: 'w-ltc', timestamp_utc: '2025-04-01T00:00:00.000Z', asset_symbol: 'LTC', currency: 'LTC', amount: 1.5, direction: 'in', native_usd: 150, tx_hash: 'd'.repeat(64), counterparty_address: LTC_PEER },
		{ id: 'i-ltc-out', tenant_id: TENANT, source: 'litecoin', account_id: 'a-ltc', wallet_id: 'w-ltc', timestamp_utc: '2025-05-01T00:00:00.000Z', asset_symbol: 'LTC', currency: 'LTC', amount: -0.25, direction: 'out', native_usd: 25, tx_hash: 'e'.repeat(64), counterparty_address: LTC_PEER },
		{ id: 'i-ltc-legacy', tenant_id: TENANT, source: 'litecoin', account_id: 'a-ltc', wallet_id: 'w-ltc', timestamp_utc: '2025-06-01T00:00:00.000Z', asset_symbol: 'LTC', currency: 'LTC', amount: 2, direction: 'in', native_usd: 200, tx_hash: 'f'.repeat(64), counterparty_address: LTC_LEGACY_PEER },
		{ id: 'i-ltc-theirs', tenant_id: OTHER, source: 'litecoin', account_id: 'a-y', wallet_id: 'w-y', timestamp_utc: '2025-04-02T00:00:00.000Z', asset_symbol: 'SECRET', currency: 'SECRET', amount: 7, direction: 'in', tx_hash: '7'.repeat(64), counterparty_address: LTC_PEER },
		{ id: 'i-theirs', tenant_id: OTHER, source: 'solana', account_id: 'a-x', wallet_id: 'w-x', timestamp_utc: '2025-09-02T00:00:00.000Z', asset_symbol: 'SECRET', currency: 'SECRET', amount: 9, direction: 'in', tx_hash: 'SolSig9', counterparty_address: SOL_PEER },
	] as Row[],
	sui: [
		{ id: 'Dig1:sui', tenant_id: TENANT, wallet_id: 'w-sui', digest: 'Dig1', coin_type: '0x2::sui::SUI', symbol: 'SUI', amount: '3000000000', decimals: 9, timestamp: '2025-10-01T00:00:00.000Z', fee_mist: '0', status: 'success', counterparty_address: SUI_PEER },
		{ id: 'Dig9:sui', tenant_id: OTHER, wallet_id: 'w-x', digest: 'Dig9', coin_type: '0x2::sui::SUI', symbol: 'SECRET', amount: '9', decimals: 9, timestamp: '2025-10-02T00:00:00.000Z', fee_mist: '0', status: 'success', counterparty_address: SUI_PEER },
	] as Row[],
};

const COUNTERPARTY_SQL = 'AND (lower(t.from_address) = ? OR lower(t.to_address) = ?)';

function answer(stmt: { sql: string; args?: unknown[] }) {
	const { sql } = stmt;
	const args = stmt.args ?? [];
	state.calls.push({ sql, args });
	if (state.fail) throw new Error(`connection lost while running ${sql} with ${JSON.stringify(args)}`);
	const isCount = /^SELECT COUNT\(\*\) AS n FROM /.test(sql);
	const rows = (r: Row[]) => ({ rows: isCount ? [{ n: String(r.length) }] : r, rowsAffected: 0 });
	// counterparty_address is present on both tables (src/lib/counterpartyColumn.ts).
	if (/column_name = 'counterparty_address'/.test(sql)) return rows([{ name: 'import_transactions' }, { name: 'sui_transactions' }]);
	if (/information_schema\.columns/.test(sql)) return rows([]);
	if (/FROM import_transactions/.test(sql)) {
		let out = fx.imports.filter((r) => r.tenant_id === args[0]);
		if (sql.includes('AND counterparty_address = ?')) out = out.filter((r) => r.counterparty_address === args.at(-1));
		return rows(out);
	}
	if (/FROM sui_transactions s/.test(sql)) {
		let out = fx.sui.filter((r) => r.tenant_id === args[0]);
		if (sql.includes('AND s.counterparty_address = ?')) out = out.filter((r) => r.counterparty_address === args.at(-1));
		return rows(out);
	}
	if (/FROM wallets WHERE tenant_id = \? AND lower\(address\) = \?/.test(sql)) {
		return rows(fx.wallets.filter((w) => w.tenant_id === args[0] && String(w.address).toLowerCase() === args[1]));
	}
	if (/FROM transactions t/.test(sql)) {
		let out = [...fx.onchain, ...state.extraOnchain].filter((r) => r.tenant_id === args[0]);
		if (sql.includes('t.is_duplicate IS NULL OR')) out = out.filter((r) => r.is_duplicate == null || r.is_duplicate === 0 || r.is_duplicate === -1);
		if (sql.includes(COUNTERPARTY_SQL)) {
			const [from, to] = args.slice(-2);
			out = out.filter((r) => String(r.from_address).toLowerCase() === from || String(r.to_address).toLowerCase() === to);
		}
		return rows(
			out.map((t) => {
				const w = fx.wallets.find((x) => x.id === t.wallet_id && x.tenant_id === t.tenant_id);
				return { ...t, wallet_address: w?.address ?? null, annotation_note: null, annotation_category: null };
			}),
		);
	}
	throw new Error(`unexpected SQL: ${sql}`);
}

vi.mock('@/lib/db', () => ({ db: { execute: async (stmt: { sql: string; args?: unknown[] }) => answer(stmt) } }));
vi.mock('@/lib/requireTenantSession', () => ({ requireTenantSession: async () => state.session }));

import { GET, MAX_ADDRESS_ROWS, MAX_LISTED_ROWS } from '../../src/pages/api/address-history';

const call = async (query: string) => {
	const request = new Request(`https://almstins.test/api/address-history${query}`);
	return GET({ request, url: new URL(request.url) } as never) as Promise<Response>;
};
const get = (address: string) => call(`?address=${encodeURIComponent(address)}`);
const dataCalls = () => state.calls.filter((c) => !/information_schema/.test(c.sql));

beforeEach(() => {
	state.session = { tenantId: TENANT };
	state.calls = [];
	state.extraOnchain = [];
	state.fail = false;
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('refusals, before any data is read', () => {
	it('signed out gets 401', async () => {
		state.session = null;
		const res = await get(SHOP);
		expect(res.status).toBe(401);
		expect(state.calls).toEqual([]);
	});

	it('an empty, blank or overlong address is a 400', async () => {
		for (const q of ['', '?address=', '?address=%20%20', `?address=${'a'.repeat(129)}`]) {
			const res = await call(q);
			expect(res.status, q).toBe(400);
		}
		expect(state.calls).toEqual([]);
	});

	it('an exchange account id is not an on-chain address', async () => {
		const res = await get('cex:crypto_com:11111111-1111-4111-8111-111111111111');
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ supported: false, reason: 'not_onchain' });
		expect(state.calls).toEqual([]);
	});

	it('anything else that is not an address is not_onchain too', async () => {
		expect(await (await get('@burn')).json()).toEqual({ supported: false, reason: 'not_onchain' });
	});

});

describe('a Litecoin address', () => {
	it('answers the tenant’s own Litecoin rows with that counterparty, with totals and links', async () => {
		const res = await get(LTC_PEER.toUpperCase());
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.supported).toBe(true);
		expect(body.network).toBe('ltc');
		expect(body.ownWallet).toBeNull();
		expect(body.rows.map((r: { txHash: string }) => r.txHash)).toEqual(['e'.repeat(64), 'd'.repeat(64)]);
		expect(body.rows[0]).toMatchObject({ direction: 'out', chain: 'litecoin', asset: 'LTC', amount: '0.25', usdValue: '25', txUrl: `https://litecoinspace.org/tx/${'e'.repeat(64)}` });
		expect(body.totals).toEqual([{ asset: 'LTC', chain: 'litecoin', sent: '0.25', received: '1.5', count: 2, sentUsd: '25', receivedUsd: '150' }]);
		expect(JSON.stringify(body)).not.toContain('SECRET');

		// bech32 is sent lowercased, every query is scoped by the tenant, and only the import half
		// (the one with counterparty_address) is read beside the own-wallet lookup.
		const data = dataCalls();
		for (const c of data) expect(c.args[0]).toBe(TENANT);
		const imports = data.filter((c) => /FROM import_transactions/.test(c.sql));
		expect(imports.length).toBeGreaterThan(0);
		for (const c of imports) expect(c.args.at(-1)).toBe(LTC_PEER);
		expect(data.some((c) => /FROM transactions t/.test(c.sql))).toBe(false);
	});

	it('matches a legacy L… address exactly as typed (base58 is case-sensitive)', async () => {
		const body = await (await get(LTC_LEGACY_PEER)).json();
		expect(body.network).toBe('ltc');
		expect(body.rows.map((r: { txHash: string }) => r.txHash)).toEqual(['f'.repeat(64)]);
		const changedCase = await (await get(LTC_LEGACY_PEER.replace('Peer', 'pEER'))).json();
		expect(changedCase.rows).toEqual([]);
	});
});

describe('an EVM address', () => {
	it('every query is scoped by the session tenant and sends the address lowercased', async () => {
		const res = await get(`  0x${SHOP.slice(2).toUpperCase()} `);
		expect(res.status).toBe(200);
		const calls = dataCalls();
		expect(calls.length).toBeGreaterThanOrEqual(2); // own-wallet lookup, history rows
		for (const c of calls) {
			expect(c.sql, c.sql).toMatch(/\btenant_id = \?/);
			expect(c.args[0], c.sql).toBe(TENANT);
			expect(c.args.at(-1), c.sql).toBe(SHOP);
		}
		expect(calls.some((c) => c.sql.includes(COUNTERPARTY_SQL))).toBe(true);
		expect(calls.some((c) => /import_transactions|sui_transactions/.test(c.sql))).toBe(false);
	});

	it('the tenant comes from the session only: a tenantId in the query is ignored', async () => {
		const body = await (await call(`?address=${SHOP}&tenantId=${OTHER}`)).json();
		expect(JSON.stringify(body)).not.toContain('SECRET');
		expect(dataCalls().every((c) => c.args[0] === TENANT)).toBe(true);
	});

	it("returns only the user's own rows with the address, newest first, with explorer links", async () => {
		const body = await (await get(SHOP)).json();
		expect(body.rows.map((r: Row) => r.txHash)).toEqual(['0x' + '2'.repeat(64), '0x' + '4'.repeat(64), '0x' + '3'.repeat(64), '0x' + '1'.repeat(64)]);
		expect(body.rows[0]).toEqual({
			date: '2026-09-30 18:22:05',
			direction: 'out',
			chain: 'polygon',
			asset: 'USDC',
			amount: '700',
			usdValue: '700',
			txHash: '0x' + '2'.repeat(64),
			txUrl: `https://polygonscan.com/tx/0x${'2'.repeat(64)}`,
			failed: false,
		});
		expect(body.rows[2]).toMatchObject({ chain: 'ethereum', failed: true, amount: '0', txUrl: `https://etherscan.io/tx/0x${'3'.repeat(64)}` });
		expect(body.truncated).toBe(false);
	});

	it('totals match the rows: exact sums, failed as zero, no USD total where a value is missing', async () => {
		const body = await (await get(SHOP)).json();
		expect(body.totals).toEqual([
			{ asset: 'ETH', chain: 'ethereum', sent: '0', received: '0.1', count: 2, sentUsd: '0', receivedUsd: '' },
			{ asset: 'USDC', chain: 'polygon', sent: '1200', received: '0', count: 2, sentUsd: '1200', receivedUsd: '' },
		]);
		expect(body.firstDate).toBe('2025-02-01 10:00:00');
		expect(body.lastDate).toBe('2026-09-30 18:22:05');
	});

	it('the answer has exactly the planned fields, and no others', async () => {
		const body = await (await get(SHOP)).json();
		expect(Object.keys(body).sort()).toEqual(['firstDate', 'lastDate', 'network', 'ownWallet', 'rows', 'supported', 'totals', 'truncated']);
		expect(body).toMatchObject({ supported: true, network: 'evm', ownWallet: null });
		for (const r of body.rows) {
			expect(Object.keys(r).sort()).toEqual(['amount', 'asset', 'chain', 'date', 'direction', 'failed', 'txHash', 'txUrl', 'usdValue']);
		}
		for (const t of body.totals) {
			expect(Object.keys(t).sort()).toEqual(['asset', 'chain', 'count', 'received', 'receivedUsd', 'sent', 'sentUsd']);
		}
	});

	it("one of the user's own wallets is named, with its label", async () => {
		const body = await (await get(SECOND.toUpperCase().replace('0X', '0x'))).json();
		expect(body.ownWallet).toEqual({ id: 'w-second', label: null });
		expect(body.rows.map((r: Row) => r.txHash)).toEqual(['0x' + '5'.repeat(64)]);
		expect((await (await get(MINE)).json()).ownWallet).toEqual({ id: 'w-main', label: 'Main' });
	});

	it("another tenant's wallet is not the user's own, and their rows never come back", async () => {
		const body = await (await get(OTHERS_WALLET)).json();
		expect(body).toMatchObject({ supported: true, ownWallet: null, rows: [], totals: [], firstDate: '', lastDate: '', truncated: false });
	});

	it('is never cached', async () => {
		const res = await get(SHOP);
		expect(res.headers.get('Cache-Control')).toBe('no-store');
		expect(res.headers.get('Content-Type')).toBe('application/json');
	});
});

describe('a Bitcoin, Solana or Sui address', () => {
	it('returns the rows whose stored counterparty is the address, with explorer links', async () => {
		const btc = await (await get(BTC_PEER.toUpperCase())).json();
		expect(btc).toMatchObject({ supported: true, network: 'btc', ownWallet: null, truncated: false });
		expect(btc.rows).toEqual([
			{ date: '2025-08-01 00:00:00', direction: 'in', chain: 'bitcoin', asset: 'BTC', amount: '0.002', usdValue: '120', txHash: 'b'.repeat(64), txUrl: `https://blockstream.info/tx/${'b'.repeat(64)}`, failed: false },
		]);
		expect(btc.totals).toEqual([{ asset: 'BTC', chain: 'bitcoin', sent: '0', received: '0.002', count: 1, sentUsd: '', receivedUsd: '120' }]);

		const sol = await (await get(SOL_PEER)).json();
		expect(sol).toMatchObject({ supported: true, network: 'sol' });
		expect(sol.rows.map((r: Row) => [r.direction, r.asset, r.amount, r.txHash])).toEqual([['out', 'USDC', '25', 'SolSig1']]);

		const sui = await (await get(SUI_PEER)).json();
		expect(sui).toMatchObject({ supported: true, network: 'sui' });
		expect(sui.rows.map((r: Row) => [r.direction, r.asset, r.amount, r.txHash])).toEqual([['in', 'SUI', '3', 'Dig1']]);
	});

	it('every query is scoped by the session tenant and sends the address in its stored form', async () => {
		await get(` ${BTC_PEER.toUpperCase()} `);
		await get(SOL_PEER);
		const calls = dataCalls();
		for (const c of calls) {
			expect(c.sql, c.sql).toMatch(/\btenant_id = \?/);
			expect(c.args[0], c.sql).toBe(TENANT);
		}
		const filtered = calls.filter((c) => /counterparty_address = \?/.test(c.sql));
		expect(filtered.map((c) => c.args.at(-1))).toEqual(expect.arrayContaining([BTC_PEER, SOL_PEER]));
		// The EVM half is not read for these.
		expect(calls.some((c) => /FROM transactions t/.test(c.sql))).toBe(false);
	});

	it('base58 is matched as written, and another tenant\'s rows with the same address never come back', async () => {
		const lower = await (await get(SOL_PEER.toLowerCase())).json();
		expect(lower.rows ?? []).toEqual([]);
		const body = JSON.stringify(await (await get(SOL_PEER)).json()) + JSON.stringify(await (await get(SUI_PEER)).json());
		expect(body).not.toContain('SECRET');
	});
});

describe('long histories', () => {
	const extra = (count: number) =>
		Array.from({ length: count }, (_, i) => ({
			id: `x${String(i).padStart(5, '0')}`, tenant_id: TENANT, wallet_id: 'w-main', chain: 'polygon',
			hash: '0x' + i.toString(16).padStart(64, '0'), timestamp: new Date(Date.UTC(2024, 0, 1) + i * 60_000).toISOString(),
			from_address: MINE, to_address: SHOP, value: '1000000', token_symbol: 'USDC', token_decimals: 6,
			tx_type: 'token_out', status: 'confirmed', usd_value: 1, is_duplicate: 0,
		}));

	it(`lists the newest ${MAX_LISTED_ROWS} rows, flags truncated, and totals every row`, async () => {
		state.extraOnchain = extra(MAX_LISTED_ROWS);
		const body = await (await get(SHOP)).json();
		expect(body.rows).toHaveLength(MAX_LISTED_ROWS);
		expect(body.truncated).toBe(true);
		expect(body.rows[0].txHash).toBe('0x' + '2'.repeat(64));
		const usdc = body.totals.find((t: Row) => t.asset === 'USDC');
		expect(usdc).toMatchObject({ count: MAX_LISTED_ROWS + 2, sent: String(1200 + MAX_LISTED_ROWS), sentUsd: String(1200 + MAX_LISTED_ROWS) });
		expect(body.firstDate).toBe('2024-01-01 00:00:00');
	});

	it(`more than ${MAX_ADDRESS_ROWS} rows is too_many, before any row is loaded`, async () => {
		state.extraOnchain = extra(MAX_ADDRESS_ROWS);
		const res = await get(SHOP);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ supported: false, reason: 'too_many' });
		expect(dataCalls().some((c) => /^SELECT t\.id/.test(c.sql.trim()))).toBe(false);
	});
});

describe('errors', () => {
	it('a database failure is a plain 500, and the log never holds the address', async () => {
		const logged: unknown[][] = [];
		vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => void logged.push(a));
		vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => void logged.push(a));
		vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => void logged.push(a));
		state.fail = true;
		const res = await get(SHOP);
		expect(res.status).toBe(500);
		const body = await res.json();
		expect(body).toEqual({ error: 'Could not load this history.' });
		expect(logged.length).toBeGreaterThan(0);
		expect(JSON.stringify(logged.map((a) => a.map(String))).toLowerCase()).not.toContain(SHOP.slice(2));
	});
});

describe('source pins', () => {
	it('the route never calls an outside service', async () => {
		const { readFileSync } = await import('node:fs');
		const path = await import('node:path');
		const src = readFileSync(path.resolve(__dirname, '../../src/pages/api/address-history.ts'), 'utf8');
		expect(src).not.toMatch(/\bfetch\(|etherscan|blockstream|routescan|https:\/\//i);
	});
});
