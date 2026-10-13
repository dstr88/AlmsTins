import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * "Whose account is this?": the owner label of each wallet and exchange account (slice 2).
 *
 *   - PATCH /api/wallets/[id] and POST /api/exchanges/{slug}/accounts/update accept an optional
 *     ownerLabel (trimmed free text, at most 60 characters, empty clears it) and save it in
 *     wallet_identity on the right wallet key(s). POST /api/exchanges/{slug}/accounts accepts
 *     one at creation.
 *   - An on-chain wallet gets the owner on every key it has: its configured chains, the chains
 *     of its rows, and any key already saved for its address.
 *   - The wallet or account must be the session tenant's (404 otherwise), and every statement is
 *     scoped by the session's tenant_id; another tenant's row with the same key is never touched.
 *   - Deleting a wallet or an exchange account removes its owner label, in this tenant only.
 *   - The demo is one tenant shared by every visitor: a demo session that sends an owner label
 *     gets the demo 403 and nothing is written (the middleware refuses it first; see
 *     tests/middleware/demoMutations.test.ts).
 *
 * Hermetic: the session is a stub and '@/lib/db' is an in-memory interpreter for the statements
 * these routes send. Unknown SQL throws, so a new statement has to be added here on purpose.
 */

const TENANT = 'tenant-a';
const OTHER = 'tenant-b';
const EVM = '0xabcdef0123456789abcdef0123456789abcdef01';
const EVM_MIXED = '0xAbCdEf0123456789aBcDeF0123456789AbCdEf01';
const SOL = '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin';
const ACCT1 = '11111111-1111-4111-8111-111111111111';
const ACCT2 = '22222222-2222-4222-8222-222222222222';
const ACCT_CB = '33333333-3333-4333-8333-333333333333';
const ACCT_OTHER = '44444444-4444-4444-8444-444444444444';

type Row = Record<string, unknown>;
type Identity = { tenant_id: string; wallet_key: string; label: string | null; owner_label: string | null };

const state = vi.hoisted(() => ({
	session: null as null | { tenantId: string; isDemo?: boolean },
	calls: [] as Array<{ sql: string; args: unknown[] }>,
}));

let wallets: Row[];
let accounts: Row[];
let onchain: Row[];
let imports: Row[];
let sui: Row[];
let identity: Identity[];

function seed() {
	wallets = [
		{ id: 'w-evm', tenant_id: TENANT, address: EVM, label: 'Main', chains: JSON.stringify(['ethereum']), wallet_type: 'onchain' },
		{ id: 'w-sol', tenant_id: TENANT, address: SOL, label: 'Phantom', chains: '[]', wallet_type: 'onchain' },
		{ id: 'w-mirror', tenant_id: TENANT, address: `cex:crypto_com:${ACCT1}`, label: 'Crypto.com Account #1', chains: '[]', wallet_type: 'exchange' },
		{ id: 'w-other', tenant_id: OTHER, address: EVM, label: 'Theirs', chains: JSON.stringify(['ethereum']), wallet_type: 'onchain' },
	];
	accounts = [
		{ id: ACCT1, tenant_id: TENANT, source: 'crypto_com', name: 'Account #1' },
		{ id: ACCT2, tenant_id: TENANT, source: 'crypto_com', name: 'Account #2' },
		{ id: ACCT_CB, tenant_id: TENANT, source: 'coinbase', name: 'Coinbase' },
		{ id: ACCT_OTHER, tenant_id: OTHER, source: 'crypto_com', name: 'Their account' },
	];
	onchain = [
		{ tenant_id: TENANT, wallet_id: 'w-evm', chain: 'ethereum' },
		{ tenant_id: TENANT, wallet_id: 'w-evm', chain: 'polygon' },
		{ tenant_id: TENANT, wallet_id: 'w-evm', chain: 'AVALANCHE' },
		{ tenant_id: OTHER, wallet_id: 'w-evm', chain: 'rootstock' },
	];
	imports = [
		{ tenant_id: TENANT, wallet_id: 'w-sol', source: 'solana' },
		{ tenant_id: TENANT, wallet_id: 'w-evm', source: 'crypto_com' },
	];
	sui = [];
	identity = [
		// Saved earlier on a chain the wallet no longer lists: still this address, so it is updated too.
		{ tenant_id: TENANT, wallet_key: `base:${EVM}`, label: null, owner_label: 'Old owner' },
		// Another tenant's rows with the same keys: never touched.
		{ tenant_id: OTHER, wallet_key: `ethereum:${EVM}`, label: null, owner_label: 'Mallory' },
		{ tenant_id: OTHER, wallet_key: `cex:crypto_com:${ACCT1}`, label: null, owner_label: 'Mallory' },
	];
}

const IMPORT_COLUMNS = ['id', 'tenant_id', 'source', 'account_id', 'wallet_id', 'timestamp_utc'];

const inList = (sql: string, args: unknown[], from: number) => {
	const n = (sql.match(/IN \(([?, ]+)\)/)?.[1].match(/\?/g) ?? []).length;
	return args.slice(from, from + n).map(String);
};

/** The statements these routes send, answered from the arrays above. */
function run(stmt: string | { sql: string; args?: unknown[] }): { rows: Row[]; rowsAffected: number } {
	const sql = (typeof stmt === 'string' ? stmt : stmt.sql).replace(/\s+/g, ' ').trim();
	const args = typeof stmt === 'string' ? [] : stmt.args ?? [];
	state.calls.push({ sql, args });
	const ok = (rows: Row[] = [], rowsAffected = rows.length) => ({ rows, rowsAffected });

	if (/^CREATE TABLE IF NOT EXISTS wallet_identity/.test(sql)) return ok();
	if (/information_schema\.columns/.test(sql)) return ok(IMPORT_COLUMNS.map((name) => ({ name })));

	// wallets
	if (sql === 'SELECT 1 FROM wallets WHERE id = ? AND tenant_id = ? LIMIT 1') {
		return ok(wallets.filter((w) => w.id === args[0] && w.tenant_id === args[1]).map(() => ({ '1': 1 })));
	}
	if (sql === 'SELECT id, address, chains FROM wallets WHERE id = ? AND tenant_id = ? LIMIT 1') {
		return ok(wallets.filter((w) => w.id === args[0] && w.tenant_id === args[1]));
	}
	if (/^UPDATE wallets SET label = \? WHERE id = \? AND tenant_id = \? RETURNING/.test(sql)) {
		const w = wallets.find((x) => x.id === args[1] && x.tenant_id === args[2]);
		if (w) w.label = args[0];
		return ok(w ? [{ ...w, is_default: 0, created_at: '2026-01-01' }] : []);
	}
	if (sql === 'SELECT w.address FROM wallets w WHERE w.tenant_id = ?') return ok(wallets.filter((w) => w.tenant_id === args[0]));
	if (sql === 'DELETE FROM wallets WHERE id = ? AND tenant_id = ? RETURNING id, address') {
		const gone = wallets.filter((w) => w.id === args[0] && w.tenant_id === args[1]);
		wallets = wallets.filter((w) => !gone.includes(w));
		return ok(gone);
	}
	if (/^DELETE FROM (import_transactions|transactions) WHERE wallet_id = \? AND tenant_id = \?$/.test(sql)) return ok();

	// a wallet's chains
	if (sql === 'SELECT DISTINCT t.chain FROM transactions t WHERE t.tenant_id = ? AND t.wallet_id = ?') {
		return ok([...new Set(onchain.filter((r) => r.tenant_id === args[0] && r.wallet_id === args[1]).map((r) => r.chain))].map((chain) => ({ chain })));
	}
	if (sql === 'SELECT DISTINCT it.source FROM import_transactions it WHERE it.tenant_id = ? AND it.wallet_id = ?') {
		return ok([...new Set(imports.filter((r) => r.tenant_id === args[0] && r.wallet_id === args[1]).map((r) => r.source))].map((source) => ({ source })));
	}
	if (sql === 'SELECT 1 AS n FROM sui_transactions s WHERE s.tenant_id = ? AND s.wallet_id = ? LIMIT 1') {
		return ok(sui.filter((r) => r.tenant_id === args[0] && r.wallet_id === args[1]).slice(0, 1).map(() => ({ n: 1 })));
	}

	// wallet_identity
	if (sql === 'SELECT wi.wallet_key FROM wallet_identity wi WHERE wi.tenant_id = ?') {
		return ok(identity.filter((r) => r.tenant_id === args[0]));
	}
	if (sql === 'SELECT wi.wallet_key, wi.owner_label FROM wallet_identity wi WHERE wi.tenant_id = ? AND wi.owner_label IS NOT NULL') {
		return ok(identity.filter((r) => r.tenant_id === args[0] && r.owner_label !== null));
	}
	if (/^INSERT INTO wallet_identity \(tenant_id, wallet_key, owner_label, updated_at\) VALUES \(\?, \?, \?, to_char\(.*\)\) ON CONFLICT \(tenant_id, wallet_key\) DO UPDATE SET owner_label = excluded\.owner_label, updated_at = excluded\.updated_at$/.test(sql)) {
		const [t, key, owner] = args as [string, string, string];
		const row = identity.find((r) => r.tenant_id === t && r.wallet_key === key);
		if (row) row.owner_label = owner;
		else identity.push({ tenant_id: t, wallet_key: key, label: null, owner_label: owner });
		return ok([], 1);
	}
	if (/^UPDATE wallet_identity SET owner_label = NULL, updated_at = to_char\(.*\) WHERE tenant_id = \? AND wallet_key IN \([?, ]+\)$/.test(sql)) {
		const keys = inList(sql, args, 1);
		const hit = identity.filter((r) => r.tenant_id === args[0] && keys.includes(r.wallet_key));
		hit.forEach((r) => (r.owner_label = null));
		return ok([], hit.length);
	}
	if (/^DELETE FROM wallet_identity WHERE tenant_id = \? AND wallet_key IN \([?, ]+\)( AND label IS NULL AND owner_label IS NULL)?$/.test(sql)) {
		const keys = inList(sql, args, 1);
		const onlyEmpty = /label IS NULL/.test(sql);
		const before = identity.length;
		identity = identity.filter(
			(r) => !(r.tenant_id === args[0] && keys.includes(r.wallet_key) && (!onlyEmpty || (r.label === null && r.owner_label === null))),
		);
		return ok([], before - identity.length);
	}
	if (sql === 'DELETE FROM wallet_identity WHERE tenant_id = ? AND wallet_key = ?') {
		const before = identity.length;
		identity = identity.filter((r) => !(r.tenant_id === args[0] && r.wallet_key === args[1]));
		return ok([], before - identity.length);
	}

	// exchange_accounts
	if (sql === 'SELECT COUNT(*) AS count FROM exchange_accounts WHERE tenant_id = ? AND source = ?') {
		return ok([{ count: accounts.filter((a) => a.tenant_id === args[0] && a.source === args[1]).length }]);
	}
	if (sql === 'INSERT INTO exchange_accounts (id, tenant_id, source, name) VALUES (?, ?, ?, ?)') {
		accounts.push({ id: args[0], tenant_id: args[1], source: args[2], name: args[3] });
		return ok([], 1);
	}
	if (sql === 'SELECT ea.id FROM exchange_accounts ea WHERE ea.tenant_id = ? AND ea.id = ? AND ea.source = ? LIMIT 1') {
		return ok(accounts.filter((a) => a.tenant_id === args[0] && a.id === args[1] && a.source === args[2]));
	}
	if (sql === 'UPDATE exchange_accounts SET name = ? WHERE tenant_id = ? AND id = ? AND source = ?') {
		const a = accounts.find((x) => x.tenant_id === args[1] && x.id === args[2] && x.source === args[3]);
		if (a) a.name = args[0];
		return ok([], a ? 1 : 0);
	}
	// the account delete routes
	let m = /^SELECT id FROM exchange_accounts WHERE id = \? AND tenant_id = \? AND source = '(\w+)'$/.exec(sql);
	if (m) return ok(accounts.filter((a) => a.id === args[0] && a.tenant_id === args[1] && a.source === m![1]));
	if (sql === 'SELECT id, source FROM exchange_accounts WHERE id = ? AND tenant_id = ? LIMIT 1') {
		return ok(accounts.filter((a) => a.id === args[0] && a.tenant_id === args[1]));
	}
	if (sql === 'SELECT COUNT(*) AS cnt FROM import_transactions WHERE account_id = ? AND tenant_id = ?') return ok([{ cnt: 0 }]);
	if (sql === 'DELETE FROM exchange_accounts WHERE id = ? AND tenant_id = ?') {
		const before = accounts.length;
		accounts = accounts.filter((a) => !(a.id === args[0] && a.tenant_id === args[1]));
		return ok([], before - accounts.length);
	}
	if (/^DELETE FROM (import_raw_rows|import_transactions) WHERE (account_id = \? AND tenant_id = \?|tenant_id = \? AND source = 'crypto_com' AND)/.test(sql)) return ok();

	throw new Error(`unexpected SQL: ${sql}`);
}

vi.mock('@/lib/db', () => ({
	db: {
		execute: async (stmt: string | { sql: string; args?: unknown[] }) => run(stmt),
		batch: async (stmts: Array<string | { sql: string; args?: unknown[] }>) => stmts.map((s) => run(s)),
	},
}));
vi.mock('@/lib/requireTenantSession', () => ({ requireTenantSession: async () => state.session }));

import { PATCH as walletPATCH, DELETE as walletDELETE } from '../../src/pages/api/wallets/[id]';
import { POST as cryptoUpdate } from '../../src/pages/api/exchanges/crypto-com/accounts/update';
import { POST as cryptoCreate } from '../../src/pages/api/exchanges/crypto-com/accounts';
import { POST as coinbaseUpdate } from '../../src/pages/api/exchanges/coinbase/accounts/update';
import { POST as cryptoDelete } from '../../src/pages/api/exchanges/crypto-com/accounts/delete';
import { DELETE as accountDELETE } from '../../src/pages/api/exchange-accounts/[id]';
import { DEMO_TENANT_ID } from '../../src/lib/demo';
import {
	OWNER_LABEL_MAX,
	guessChainFromAddress,
	parseChainList,
	parseOwnerLabel,
	resetOwnerLabelLimiter,
	walletKeysFromChains,
} from '../../src/lib/walletOwnerLabel';

const req = (method: string, body?: unknown) =>
	new Request('https://almstins.test/api/x', {
		method,
		headers: { 'Content-Type': 'application/json' },
		body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
	});

const patchWallet = (id: string, body: unknown) => walletPATCH({ params: { id }, request: req('PATCH', body) } as never) as Promise<Response>;
const deleteWallet = (id: string) => walletDELETE({ params: { id }, request: req('DELETE') } as never) as Promise<Response>;
const post = (handler: typeof cryptoUpdate, body: unknown) => handler({ request: req('POST', body) } as never) as Promise<Response>;

const owners = (tenant = TENANT) =>
	Object.fromEntries(identity.filter((r) => r.tenant_id === tenant).map((r) => [r.wallet_key, r.owner_label]));
const identityCalls = () => state.calls.filter((c) => /wallet_identity/.test(c.sql) && !/^CREATE TABLE/.test(c.sql));
const OTHER_ROWS = () => identity.filter((r) => r.tenant_id === OTHER);

beforeEach(() => {
	seed();
	state.session = { tenantId: TENANT };
	state.calls = [];
	resetOwnerLabelLimiter();
	vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
	vi.restoreAllMocks();
});

// ── The value ────────────────────────────────────────────────────────────────

describe('parseOwnerLabel', () => {
	it('trims, collapses spaces, and turns control and direction characters into spaces', () => {
		expect(parseOwnerLabel('  Spouse  ')).toEqual({ ok: true, value: 'Spouse' });
		expect(parseOwnerLabel('Me\n\tand\u202Eyou')).toEqual({ ok: true, value: 'Me and you' });
		expect(parseOwnerLabel('Cónyuge')).toEqual({ ok: true, value: 'Cónyuge' });
	});

	it('empty, blank or null clears it', () => {
		for (const v of ['', '   ', null, undefined]) expect(parseOwnerLabel(v)).toEqual({ ok: true, value: null });
	});

	it('anything but text is refused', () => {
		for (const v of [5, true, ['Me'], { a: 1 }]) expect(parseOwnerLabel(v)).toEqual({ ok: false, error: 'OWNER_LABEL_INVALID' });
	});

	it(`at most ${OWNER_LABEL_MAX} characters, counted as characters (an emoji is one)`, () => {
		expect(parseOwnerLabel('a'.repeat(OWNER_LABEL_MAX))).toEqual({ ok: true, value: 'a'.repeat(OWNER_LABEL_MAX) });
		expect(parseOwnerLabel('a'.repeat(OWNER_LABEL_MAX + 1))).toEqual({ ok: false, error: 'OWNER_LABEL_TOO_LONG' });
		expect(parseOwnerLabel('👪'.repeat(OWNER_LABEL_MAX)).ok).toBe(true);
	});
});

describe('the keys of a wallet', () => {
	it('one key per chain, chain names normalized, EVM lowercased, sorted, no duplicates', () => {
		expect(walletKeysFromChains(EVM_MIXED, ['Ethereum', 'polygon', 'MATIC', 'avalanche_cchain', 'eth'])).toEqual([
			`avalanche:${EVM}`,
			`ethereum:${EVM}`,
			`polygon:${EVM}`,
		]);
	});

	it('an exchange mirror row is its account key; base58 keeps its case', () => {
		expect(walletKeysFromChains(`cex:crypto_com:${ACCT1}`, ['ethereum'])).toEqual([`cex:crypto_com:${ACCT1}`]);
		expect(walletKeysFromChains(SOL, ['solana'])).toEqual([`solana:${SOL}`]);
	});

	it('no chain at all: one key from the shape of the address', () => {
		expect(walletKeysFromChains(EVM, [])).toEqual([`ethereum:${EVM}`]);
		expect(walletKeysFromChains(SOL, [])).toEqual([`solana:${SOL}`]);
		expect(guessChainFromAddress('bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq')).toBe('bitcoin');
		expect(guessChainFromAddress('0x' + 'ab'.repeat(32))).toBe('sui');
	});

	it('wallets.chains as text or as an array; anything else is no chains', () => {
		expect(parseChainList('["ethereum","polygon"]')).toEqual(['ethereum', 'polygon']);
		expect(parseChainList(['bitcoin', 3, ''])).toEqual(['bitcoin']);
		expect(parseChainList('not json')).toEqual([]);
		expect(parseChainList(null)).toEqual([]);
	});
});

// ── PATCH /api/wallets/[id] ──────────────────────────────────────────────────

describe('PATCH /api/wallets/[id] with ownerLabel', () => {
	it('sets the owner once on every key of the wallet: configured chains, chains of its rows, and keys saved before', async () => {
		const res = await patchWallet('w-evm', { ownerLabel: '  Spouse ' });
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true, id: 'w-evm', ownerLabel: 'Spouse' });
		// ethereum (configured and rows), polygon and avalanche (rows), base (saved before). The
		// imported crypto_com row is an exchange source, not a chain of this wallet.
		expect(owners()).toEqual({
			[`avalanche:${EVM}`]: 'Spouse',
			[`base:${EVM}`]: 'Spouse',
			[`ethereum:${EVM}`]: 'Spouse',
			[`polygon:${EVM}`]: 'Spouse',
		});
		expect(OTHER_ROWS().map((r) => r.owner_label)).toEqual(['Mallory', 'Mallory']);
	});

	it('every statement is scoped by the session tenant, and the conflict target includes it', async () => {
		await patchWallet('w-evm', { ownerLabel: 'Me' });
		const data = state.calls.filter((c) => !/^CREATE TABLE|information_schema/.test(c.sql));
		expect(data.length).toBeGreaterThan(4);
		for (const c of data) {
			expect(c.sql, c.sql).toMatch(/\btenant_id = \?/.test(c.sql) ? /\btenant_id = \?/ : /^INSERT INTO wallet_identity \(tenant_id,/);
			expect(c.args, c.sql).toContain(TENANT);
			expect(c.args, c.sql).not.toContain(OTHER);
		}
		for (const c of identityCalls().filter((x) => /^INSERT/.test(x.sql))) {
			expect(c.sql).toMatch(/ON CONFLICT \(tenant_id, wallet_key\)/);
			expect(c.args[0]).toBe(TENANT);
		}
	});

	it('a chain-synced wallet gets the chain of its imports (solana), not the exchange sources', async () => {
		await patchWallet('w-sol', { ownerLabel: 'Me' });
		expect(owners()[`solana:${SOL}`]).toBe('Me');
	});

	it("an exchange account's mirror wallet sets that account's key only", async () => {
		await patchWallet('w-mirror', { ownerLabel: 'Me' });
		expect(owners()[`cex:crypto_com:${ACCT1}`]).toBe('Me');
		expect(state.calls.some((c) => /FROM transactions t|FROM sui_transactions/.test(c.sql))).toBe(false);
		expect(OTHER_ROWS().find((r) => r.wallet_key === `cex:crypto_com:${ACCT1}`)?.owner_label).toBe('Mallory');
	});

	it('empty clears it on every key, and a key with no label left is removed', async () => {
		await patchWallet('w-evm', { ownerLabel: 'Spouse' });
		identity.find((r) => r.tenant_id === TENANT && r.wallet_key === `polygon:${EVM}`)!.label = 'Kept name';
		const res = await patchWallet('w-evm', { ownerLabel: '' });
		expect(await res.json()).toEqual({ ok: true, id: 'w-evm', ownerLabel: null });
		expect(owners()).toEqual({ [`polygon:${EVM}`]: null });
		expect(OTHER_ROWS()).toHaveLength(2);
	});

	it('rename and owner in one request', async () => {
		const res = await patchWallet('w-evm', { label: 'Cold', ownerLabel: 'Me' });
		expect(await res.json()).toEqual({ ok: true, id: 'w-evm', label: 'Cold', ownerLabel: 'Me' });
		expect(wallets.find((w) => w.id === 'w-evm')!.label).toBe('Cold');
		expect(owners()[`ethereum:${EVM}`]).toBe('Me');
	});

	it('a rename without ownerLabel leaves the owner alone', async () => {
		await patchWallet('w-evm', { label: 'Cold' });
		expect(identityCalls()).toEqual([]);
	});

	it("another tenant's wallet is a 404, and nothing is written", async () => {
		const res = await patchWallet('w-other', { ownerLabel: 'Me' });
		expect(res.status).toBe(404);
		expect(identityCalls()).toEqual([]);
	});

	it('more than 60 characters, or not text, is a 400 before anything is written', async () => {
		for (const ownerLabel of ['x'.repeat(61), 42]) {
			const res = await patchWallet('w-evm', { label: 'Renamed', ownerLabel });
			expect(res.status).toBe(400);
			expect((await res.json()).error).toMatch(/^OWNER_LABEL_(TOO_LONG|INVALID)$/);
		}
		expect(wallets.find((w) => w.id === 'w-evm')!.label).toBe('Main');
		expect(identityCalls()).toEqual([]);
	});

	it('a body that is not JSON is a 400', async () => {
		const res = await walletPATCH({ params: { id: 'w-evm' }, request: req('PATCH', 'nope') } as never);
		expect(res.status).toBe(400);
	});

	it('owner writes are rate-limited per account (429)', async () => {
		for (let i = 0; i < 60; i++) expect((await patchWallet('w-sol', { ownerLabel: `Me ${i}` })).status).toBe(200);
		const res = await patchWallet('w-sol', { ownerLabel: 'Me' });
		expect(res.status).toBe(429);
		expect(owners()[`solana:${SOL}`]).toBe('Me 59');
	});
});

// ── Exchange accounts ────────────────────────────────────────────────────────

describe('POST /api/exchanges/{slug}/accounts/update with ownerLabel', () => {
	it("sets the owner on that account's own key: two accounts at one exchange, two owners", async () => {
		expect((await post(cryptoUpdate, { accountId: ACCT1, ownerLabel: 'Me' })).status).toBe(200);
		const res = await post(cryptoUpdate, { accountId: ACCT2, ownerLabel: 'Spouse' });
		expect(await res.json()).toEqual({ ok: true, accountId: ACCT2, ownerLabel: 'Spouse' });
		expect(owners()[`cex:crypto_com:${ACCT1}`]).toBe('Me');
		expect(owners()[`cex:crypto_com:${ACCT2}`]).toBe('Spouse');
		expect(OTHER_ROWS().find((r) => r.wallet_key === `cex:crypto_com:${ACCT1}`)?.owner_label).toBe('Mallory');
	});

	it('rename only still works, and does not touch the owner', async () => {
		const res = await post(cryptoUpdate, { accountId: ACCT1, name: 'Joint' });
		expect(await res.json()).toEqual({ ok: true, accountId: ACCT1, name: 'Joint' });
		expect(accounts.find((a) => a.id === ACCT1)!.name).toBe('Joint');
		expect(identityCalls()).toEqual([]);
	});

	it('rename and owner together; empty clears the owner', async () => {
		await post(cryptoUpdate, { accountId: ACCT1, name: 'Joint', ownerLabel: 'Both of us' });
		expect(owners()[`cex:crypto_com:${ACCT1}`]).toBe('Both of us');
		await post(cryptoUpdate, { accountId: ACCT1, ownerLabel: '' });
		expect(owners()[`cex:crypto_com:${ACCT1}`]).toBeUndefined();
	});

	it("another tenant's account, or this tenant's account at another exchange, is a 404 with nothing written", async () => {
		expect((await post(cryptoUpdate, { accountId: ACCT_OTHER, ownerLabel: 'Me', name: 'Hijack' })).status).toBe(404);
		expect((await post(coinbaseUpdate, { accountId: ACCT1, ownerLabel: 'Me' })).status).toBe(404);
		expect(identityCalls()).toEqual([]);
		expect(accounts.find((a) => a.id === ACCT_OTHER)!.name).toBe('Their account');
	});

	it('a tenantId in the body is ignored: the tenant comes from the session', async () => {
		await post(cryptoUpdate, { accountId: ACCT1, ownerLabel: 'Me', tenantId: OTHER, tenant_id: OTHER });
		for (const c of state.calls.filter((x) => !/^CREATE TABLE/.test(x.sql))) expect(c.args).not.toContain(OTHER);
	});

	it('no accountId, or neither name nor ownerLabel, is a 400; too long is a 400; signed out is a 401', async () => {
		expect((await post(cryptoUpdate, { ownerLabel: 'Me' })).status).toBe(400);
		expect((await post(cryptoUpdate, { accountId: ACCT1 })).status).toBe(400);
		expect((await post(cryptoUpdate, { accountId: ACCT1, ownerLabel: 'x'.repeat(61) })).status).toBe(400);
		state.session = null;
		expect((await post(cryptoUpdate, { accountId: ACCT1, ownerLabel: 'Me' })).status).toBe(401);
		expect(identityCalls()).toEqual([]);
	});

	it('the coinbase route keys on its own source', async () => {
		await post(coinbaseUpdate, { accountId: ACCT_CB, ownerLabel: 'Me' });
		expect(owners()[`cex:coinbase:${ACCT_CB}`]).toBe('Me');
	});
});

describe('POST /api/exchanges/{slug}/accounts: "Add account" with an owner', () => {
	it('creates Account #N and saves the owner on its new key', async () => {
		const res = await post(cryptoCreate, { ownerLabel: 'Spouse' });
		const body = await res.json();
		expect(body).toMatchObject({ ok: true, name: 'Account #3', ownerLabel: 'Spouse' });
		expect(accounts.find((a) => a.id === body.accountId)).toMatchObject({ tenant_id: TENANT, source: 'crypto_com' });
		expect(owners()[`cex:crypto_com:${body.accountId}`]).toBe('Spouse');
	});

	it('without an owner, nothing is written to wallet_identity (and an empty body still works)', async () => {
		const res = await cryptoCreate({ request: req('POST') } as never);
		expect((await res.json()).ownerLabel).toBeNull();
		expect(identityCalls()).toEqual([]);
	});

	it('an owner that is too long is a 400, and no account is created', async () => {
		const res = await post(cryptoCreate, { ownerLabel: 'x'.repeat(61) });
		expect(res.status).toBe(400);
		expect(accounts).toHaveLength(4);
	});
});

// ── Deleting ─────────────────────────────────────────────────────────────────

describe('deleting a wallet or an exchange account removes its owner label, in this tenant only', () => {
	it('a wallet: every key of its address goes; other wallets and other tenants keep theirs', async () => {
		await patchWallet('w-evm', { ownerLabel: 'Spouse' });
		await patchWallet('w-sol', { ownerLabel: 'Me' });
		expect((await deleteWallet('w-evm')).status).toBe(204);
		expect(owners()).toEqual({ [`solana:${SOL}`]: 'Me' });
		expect(OTHER_ROWS().map((r) => r.wallet_key).sort()).toEqual([`cex:crypto_com:${ACCT1}`, `ethereum:${EVM}`]);
		for (const c of identityCalls()) expect(c.args[0]).toBe(TENANT);
	});

	it("an exchange account's mirror wallet: the account keeps its owner", async () => {
		await post(cryptoUpdate, { accountId: ACCT1, ownerLabel: 'Me' });
		expect((await deleteWallet('w-mirror')).status).toBe(204);
		expect(owners()[`cex:crypto_com:${ACCT1}`]).toBe('Me');
	});

	it('an exchange account (per-exchange route): its key goes, the other account and other tenant keep theirs', async () => {
		await post(cryptoUpdate, { accountId: ACCT1, ownerLabel: 'Me' });
		await post(cryptoUpdate, { accountId: ACCT2, ownerLabel: 'Spouse' });
		expect((await post(cryptoDelete, { accountId: ACCT1 })).status).toBe(200);
		expect(owners()[`cex:crypto_com:${ACCT1}`]).toBeUndefined();
		expect(owners()[`cex:crypto_com:${ACCT2}`]).toBe('Spouse');
		expect(OTHER_ROWS().find((r) => r.wallet_key === `cex:crypto_com:${ACCT1}`)?.owner_label).toBe('Mallory');
	});

	it('an exchange account (DELETE /api/exchange-accounts/:id): same', async () => {
		await post(coinbaseUpdate, { accountId: ACCT_CB, ownerLabel: 'Me' });
		const res = await accountDELETE({ params: { id: ACCT_CB }, request: req('DELETE') } as never);
		expect(res.status).toBe(200);
		expect(owners()[`cex:coinbase:${ACCT_CB}`]).toBeUndefined();
		expect(OTHER_ROWS()).toHaveLength(2);
	});

	it("another tenant's account cannot be deleted, so its owner label stays", async () => {
		const res = await post(cryptoDelete, { accountId: ACCT_OTHER });
		expect(res.status).toBe(404);
		expect(identityCalls()).toEqual([]);
	});
});

describe('a demo session cannot set an owner label (one tenant shared by every visitor)', () => {
	const DEMO_ACCT = '55555555-5555-4555-8555-555555555555';
	beforeEach(() => {
		state.session = { tenantId: DEMO_TENANT_ID, isDemo: true };
		wallets.push({ id: 'w-demo', tenant_id: DEMO_TENANT_ID, address: EVM, label: 'Ethereum Main', chains: JSON.stringify(['ethereum']), wallet_type: 'onchain' });
		accounts.push({ id: DEMO_ACCT, tenant_id: DEMO_TENANT_ID, source: 'crypto_com', name: 'Account #1' });
		identity.push({ tenant_id: DEMO_TENANT_ID, wallet_key: `ethereum:${EVM}`, label: null, owner_label: 'Me' });
	});

	const expectDemo403 = async (res: Response) => {
		expect(res.status).toBe(403);
		expect(await res.json()).toMatchObject({ ok: false, demo: true });
	};
	const demoOwners = () => owners(DEMO_TENANT_ID);

	it('PATCH /api/wallets/[id] with ownerLabel is a 403 and writes nothing', async () => {
		await expectDemo403(await patchWallet('w-demo', { ownerLabel: 'Anything a visitor types' }));
		expect(identityCalls()).toEqual([]);
		expect(demoOwners()).toEqual({ [`ethereum:${EVM}`]: 'Me' });
	});

	it('a clear (empty ownerLabel) is refused the same way', async () => {
		await expectDemo403(await patchWallet('w-demo', { ownerLabel: '' }));
		expect(identityCalls()).toEqual([]);
		expect(demoOwners()).toEqual({ [`ethereum:${EVM}`]: 'Me' });
	});

	it('a rename sent with ownerLabel is refused whole: the label is not changed either', async () => {
		await expectDemo403(await patchWallet('w-demo', { label: 'Renamed', ownerLabel: 'Spouse' }));
		expect(state.calls.some((c) => /^UPDATE wallets/.test(c.sql))).toBe(false);
		expect(wallets.find((w) => w.id === 'w-demo')?.label).toBe('Ethereum Main');
		expect(identityCalls()).toEqual([]);
	});

	it('the exchange update and "Add account" routes refuse it too, before anything is written', async () => {
		await expectDemo403(await post(cryptoUpdate, { accountId: DEMO_ACCT, ownerLabel: 'Spouse' }));
		await expectDemo403(await post(cryptoUpdate, { accountId: DEMO_ACCT, name: 'Renamed', ownerLabel: 'Spouse' }));
		const before = accounts.length;
		await expectDemo403(await post(cryptoCreate, { ownerLabel: 'Spouse' }));
		expect(accounts).toHaveLength(before);
		expect(accounts.find((a) => a.id === DEMO_ACCT)?.name).toBe('Account #1');
		expect(identityCalls()).toEqual([]);
	});

	it('a signed-in account is not affected', async () => {
		state.session = { tenantId: TENANT };
		expect((await patchWallet('w-evm', { ownerLabel: 'Me' })).status).toBe(200);
		expect(owners()[`ethereum:${EVM}`]).toBe('Me');
		expect(demoOwners()).toEqual({ [`ethereum:${EVM}`]: 'Me' });
	});
});
