import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Regression: once the Bitcoin sync worked, a wallet's bitcoin was counted up to three times.
 *
 * - Two snapshots for the same wallet and chain written in the same second (Sync Tins and the
 *   wallet card's refresh) both matched MAX(captured_at), so the Vault added the wallet twice.
 * - The Bitcoin sync files its transactions under an exchange account (source `bitcoin`). The Vault's
 *   "snapshot every exchange account" pass valued that account as if it were an exchange, through a
 *   `cex:bitcoin:…` mirror wallet, on top of the address's own on-chain balance.
 *
 * Every id, address and amount here is invented. No database, no network.
 */

const state = vi.hoisted(() => ({
	rows: [] as Array<Record<string, unknown>>,
	calls: [] as string[],
}));

vi.mock('@/lib/db', () => ({
	db: {
		execute: vi.fn(async (stmt: string | { sql: string }) => {
			const sql = typeof stmt === 'string' ? stmt : stmt.sql;
			state.calls.push(sql);
			if (/totals_usd AS "totalsUsd"/.test(sql)) return { rows: state.rows };
			if (/COUNT\(\*\) as count/.test(sql)) return { rows: [{ count: 0 }] };
			return { rows: [], rowsAffected: 0 };
		}),
	},
}));
vi.mock('@/lib/aave/client', () => ({
	getAaveTotalsForWallet: async () => ({ suppliedUsd: 0, debtUsd: 0, chains: [] }),
}));
vi.mock('@/lib/repriceMissingWalletTokens', () => ({ repriceMissingWalletTokens: async () => ({}) }));

import { getLatestNetWorthSummary } from '../../src/lib/networth';
import { snapshotCexAccount } from '../../src/lib/cexSnapshot';
import { isOnChainImportMirror, networthSummaryCacheKey, onePerWalletChain } from '../../src/lib/snapshotRows';

const CORE = 'bc1qcoreaddressxxxxxxxxxxxxxxxxxxxxxxxxx';
const row = (walletId: string, address: string, chain: string, totalsUsd: number) => ({
	walletId,
	walletLabel: walletId,
	walletAddress: address,
	chain,
	totalsUsd,
	capturedAt: '2026-10-24 23:12:50',
});

beforeEach(() => {
	state.rows = [];
	state.calls = [];
});

describe('the Vault total counts a bitcoin wallet once', () => {
	it('keeps one snapshot when two were written in the same second', async () => {
		state.rows = [row('core', CORE, 'bitcoin', 80), row('core', CORE, 'bitcoin', 80)];

		const summary = await getLatestNetWorthSummary('t1');

		expect(summary.totalUsd).toBeCloseTo(80, 6);
	});

	it('ignores the cex:bitcoin mirror of the on-chain import account', async () => {
		state.rows = [
			row('core', CORE, 'bitcoin', 80),
			row('mirror', 'cex:bitcoin:00000000-0000-0000-0000-000000000000', 'exchange', 80),
			row('exodus', 'cex:exodus:00000000-0000-0000-0000-000000000001', 'exchange', 8000),
		];

		const summary = await getLatestNetWorthSummary('t1');

		expect(summary.totalUsd).toBeCloseTo(8080, 6);
	});
});

describe('the exchange snapshot pass skips on-chain import accounts', () => {
	it('writes nothing for a bitcoin or litecoin account', async () => {
		await snapshotCexAccount('t1', 'acc-btc', 'bitcoin', 'Bitcoin Wallet (bc1q…)');
		await snapshotCexAccount('t1', 'acc-ltc', 'litecoin', 'Litecoin Wallet (ltc1…)');

		expect(state.calls).toEqual([]);
	});

	it('still reads an exchange account', async () => {
		await snapshotCexAccount('t1', 'acc-exodus', 'exodus', 'Exodus');

		expect(state.calls.some((sql) => /FROM import_transactions/.test(sql))).toBe(true);
	});
});

describe('snapshotRows helpers', () => {
	it('recognises only on-chain import mirrors', () => {
		expect(isOnChainImportMirror('cex:bitcoin:abc')).toBe(true);
		expect(isOnChainImportMirror('CEX:Litecoin:abc')).toBe(true);
		expect(isOnChainImportMirror('cex:exodus:abc')).toBe(false);
		expect(isOnChainImportMirror(CORE)).toBe(false);
		expect(isOnChainImportMirror(null)).toBe(false);
	});

	it('keeps the first row per wallet and chain', () => {
		const kept = onePerWalletChain(
			[{ w: 'a', c: 'x', n: 1 }, { w: 'a', c: 'x', n: 2 }, { w: 'a', c: 'y', n: 3 }, { w: 'b', c: 'x', n: 4 }],
			(r) => r.w,
			(r) => r.c,
		);
		expect(kept.map((r) => r.n)).toEqual([1, 3, 4]);
	});

	it('uses the cache key the summary endpoint reads', () => {
		expect(networthSummaryCacheKey('t1')).toBe('t:t1:networth:summary:v5');
	});
});
