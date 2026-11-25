import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * rebuildAssetLifecycles with several rows per transaction (one per movement, src/lib/sync/evmSyncRows.ts):
 *   - a fee-only row (value 0) is no lifecycle event;
 *   - a transfer between two of the customer's own wallets (an out row on one, an in row on the other)
 *     is linked on both sides, so it is not a disposal;
 *   - both sides of a swap are events, and neither is linked.
 *
 * Hermetic: the database and the lock are stubs. Every address, hash and amount is invented.
 */
const A = `0x${'1'.repeat(40)}`;
const B = `0x${'5'.repeat(40)}`;
const ROUTER = `0x${'4'.repeat(40)}`;
const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
const h = (n: number) => `0x${String(n).padStart(64, '0')}`;
const at = '2026-03-01T12:00:00.000Z';

const row = (o: Record<string, unknown>) => ({
	id: 'x', wallet_id: 'w-1', hash: h(1), chain: 'ethereum', block_number: 1, token_symbol: 'native', token_decimals: 18,
	value: '0', usd_value: null, timestamp: at, tx_type: 'outgoing', from_address: A, to_address: ROUTER, contract_address: null, ...o,
});

const ONCHAIN = [
	// a transfer from wallet 1 to wallet 2: a row on each
	row({ id: 'pair-out', hash: h(1), wallet_id: 'w-1', value: '500000000000000000', from_address: A, to_address: B, tx_type: 'outgoing' }),
	row({ id: 'pair-in', hash: h(1), wallet_id: 'w-2', value: '500000000000000000', from_address: A, to_address: B, tx_type: 'incoming' }),
	// a token-to-ETH swap: the fee-only row, the USDC out, the ETH back
	row({ id: 'swap-fee', hash: h(2), value: '0', tx_type: 'outgoing' }),
	row({ id: 'swap-out', hash: h(2), token_symbol: 'USDC', token_decimals: 6, value: '2000000', contract_address: USDC, tx_type: 'token_out' }),
	row({ id: 'swap-in', hash: h(2), value: '600000000000000', from_address: ROUTER, to_address: A, tx_type: 'incoming' }),
];

const state = vi.hoisted(() => ({ statements: [] as Array<{ sql: string; args: unknown[] }>, onchain: [] as unknown[] }));

vi.mock('@/lib/db', () => ({
	db: {
		execute: async (stmt: { sql: string; args?: unknown[] }) => {
			state.statements.push({ sql: stmt.sql, args: stmt.args ?? [] });
			if (/^\s*SELECT[\s\S]*FROM transactions\s/i.test(stmt.sql)) return { rows: state.onchain };
			return { rows: [] };
		},
	},
}));
vi.mock('@/lib/cacheLock', () => ({ tryAcquireLock: async () => true }));

import { rebuildAssetLifecycles } from '../../src/lib/lifecycle';

/** Each written event as { source_id, linked_transfer }. */
function writtenEvents() {
	const out: Array<{ source: string; linked: number }> = [];
	for (const s of state.statements.filter((x) => /INSERT INTO asset_lifecycle_events/.test(x.sql))) {
		for (let i = 0; i < s.args.length; i += 15) out.push({ source: String(s.args[i + 4]), linked: Number(s.args[i + 12]) });
	}
	return out.sort((a, b) => a.source.localeCompare(b.source));
}

beforeEach(() => {
	state.statements = [];
	state.onchain = ONCHAIN;
	vi.spyOn(console, 'log').mockImplementation(() => {});
	vi.spyOn(console, 'info').mockImplementation(() => {});
	vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => vi.restoreAllMocks());

describe('rebuildAssetLifecycles: a transaction with several rows', () => {
	it('reads the wallet of each row', async () => {
		await rebuildAssetLifecycles('tenant-a', { skipPricing: true });
		const read = state.statements.find((s) => /FROM transactions\s/.test(s.sql))!;
		expect(read.sql).toMatch(/SELECT id, wallet_id, hash/);
	});

	it('makes no event of a fee-only row, links an own-wallet pair, and keeps both sides of a swap unlinked', async () => {
		await rebuildAssetLifecycles('tenant-a', { skipPricing: true });
		expect(writtenEvents()).toEqual([
			{ source: 'pair-in', linked: 1 },
			{ source: 'pair-out', linked: 1 },
			{ source: 'swap-in', linked: 0 },
			{ source: 'swap-out', linked: 0 },
		]);
	});

	it('does not link an out and an in of the same wallet, or of different amounts', async () => {
		state.onchain = [
			row({ id: 'same-out', hash: h(3), wallet_id: 'w-1', value: '7', from_address: A, to_address: B }),
			row({ id: 'same-in', hash: h(3), wallet_id: 'w-1', value: '7', from_address: B, to_address: A, tx_type: 'incoming' }),
			row({ id: 'diff-out', hash: h(4), wallet_id: 'w-1', value: '7', from_address: A, to_address: B }),
			row({ id: 'diff-in', hash: h(4), wallet_id: 'w-2', value: '8', from_address: A, to_address: B, tx_type: 'incoming' }),
		];
		await rebuildAssetLifecycles('tenant-a', { skipPricing: true });
		expect(writtenEvents().every((e) => e.linked === 0)).toBe(true);
	});
});
