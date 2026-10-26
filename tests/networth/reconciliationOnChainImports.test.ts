import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Regression: the reconciliation's live amount counted an on-chain wallet's coins twice.
 *
 * The Bitcoin and Litecoin syncs file their transactions under an exchange_accounts row (source
 * `bitcoin` / `litecoin`). GET /api/reconciliation added each account's holdings, computed from
 * its imported rows, on top of the wallet snapshots, which already hold that address's balance.
 * With Litecoin history now imported, a Litecoin wallet would have shown twice its coins as well.
 * An exchange account (Coinbase here) is still counted.
 *
 * Hermetic: the session, the annual breakdown and the database are stubs. Every id, address and
 * amount is invented.
 */

const TENANT = 'tenant-a';

const state = vi.hoisted(() => ({ calls: [] as Array<{ sql: string; args: unknown[] }> }));

const importRow = (account_id: string, source: string, name: string, asset: string, amount: number) => ({
	account_id, source, name, timestamp_utc: '2025-04-01T00:00:00.000Z', asset_symbol: asset, direction: 'in',
	currency: asset, amount, to_currency: null, to_amount: null, native_usd: null, kind: 'receive', description: 'receive',
});

vi.mock('../../src/lib/requireTenantSession', () => ({ requireTenantSession: async () => ({ tenantId: TENANT }) }));
vi.mock('../../src/lib/annualBreakdown', () => ({
	buildAnnualBreakdown: async () => ({
		stillHolding: [
			{ asset: 'LTC', amount: 1.5, costUsd: 150 },
			{ asset: 'BTC', amount: 0.02, costUsd: 1000 },
			{ asset: 'ETH', amount: 2, costUsd: 4000 },
		],
	}),
}));
vi.mock('../../src/lib/db', () => ({
	db: {
		execute: async (stmt: { sql: string; args?: unknown[] }) => {
			const { sql } = stmt;
			state.calls.push({ sql, args: stmt.args ?? [] });
			if (/FROM wallet_snapshots/.test(sql)) {
				return {
					rows: [
						{ wallet_id: 'w-ltc', chain: 'litecoin', label: 'Litecoin', address: 'ltc1qreconltcxxxxxxxxxxxxxxxxxxxxxxxxxxxx', payload_json: JSON.stringify([{ symbol: 'LTC', amount: 1.5 }]) },
						{ wallet_id: 'w-btc', chain: 'bitcoin', label: 'Bitcoin', address: 'bc1qreconbtcxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', payload_json: JSON.stringify([{ symbol: 'BTC', amount: 0.02 }]) },
					],
				};
			}
			if (/FROM exchange_accounts ea/.test(sql)) {
				return {
					rows: [
						importRow('a-ltc', 'litecoin', 'Litecoin Wallet (ltc1qrecon…)', 'LTC', 1.5),
						importRow('a-btc', 'bitcoin', 'Bitcoin Wallet (bc1qrecon…)', 'BTC', 0.02),
						importRow('a-cb', 'coinbase', 'Coinbase', 'ETH', 2),
					],
				};
			}
			return { rows: [] };
		},
	},
}));

import { GET } from '../../src/pages/api/reconciliation/index';

beforeEach(() => {
	state.calls = [];
});

describe('GET /api/reconciliation', () => {
	it('counts a Litecoin or Bitcoin wallet once, at its snapshot, and still counts an exchange', async () => {
		const res = await GET({ request: new Request('https://app.test/api/reconciliation') } as never);
		expect(res.status).toBe(200);
		const items = (await res.json()) as Array<{ asset: string; liveAmount: number; status: string; sources: Array<{ kind: string; label: string }> }>;
		const by = (asset: string) => items.find((i) => i.asset === asset)!;

		expect(by('LTC').liveAmount).toBeCloseTo(1.5, 9);
		expect(by('LTC').sources.map((s) => s.kind)).toEqual(['wallet']);
		expect(by('BTC').liveAmount).toBeCloseTo(0.02, 9);
		expect(by('BTC').sources.map((s) => s.kind)).toEqual(['wallet']);
		expect(by('ETH').liveAmount).toBeCloseTo(2, 9);
		expect(by('ETH').sources).toEqual([expect.objectContaining({ kind: 'exchange', label: 'Coinbase' })]);
		for (const c of state.calls) if (c.args.length) expect(c.args[0]).toBe(TENANT);
	});
});
