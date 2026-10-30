/**
 * Per-wallet lots through both engines, with a history built so that the wallet rule and the one
 * pool disagree: from 2025-01-01 a sale draws on the wallet or account it was made from, and a
 * tenant outside the rollout still draws on the oldest coin anywhere. Invented amounts; the
 * database is mocked.
 *
 *   2023-01-10  Coinbase buys 1 ETH for 2,000
 *   2023-03-01  Coinbase buys 1 ETH for 3,000
 *   2023-09-01  Coinbase sends 1 ETH to the owner's own wallet (arrives 30 minutes later, same hash)
 *   2023-11-01  the wallet sends 1 ETH to someone else (a sale at 4,000)
 *   2024-04-01  Coinbase sells 0.5 ETH for 1,500
 *   2025-01-15  the wallet receives 1 ETH from someone else, worth 4,000 that day
 *   2025-06-01  the wallet sends 0.5 ETH to someone else (a sale at 3,000)
 *
 * End of 2024: Coinbase holds the 0.5 ETH left of the March 2023 lot; the wallet holds nothing.
 * One pool: the June 2025 sale takes that Coinbase lot (cost 1,500, long-term, gain 1,500).
 * Per wallet: the wallet only has the January 2025 coin (cost 2,000, short-term, gain 1,000).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildAnnualBreakdown } from '../../src/lib/annualBreakdown';
import { db } from '../../src/lib/db';
import { OWNER_TENANT_ID } from '../../src/lib/owner';

vi.mock('../../src/lib/db', () => ({ db: { execute: vi.fn() } }));
const mockExecute = db.execute as ReturnType<typeof vi.fn>;

const OUTSIDER = 'tenant-1';
const WALLET = `0x${'a'.repeat(40)}`;
const FAR = `0x${'f'.repeat(40)}`;
const HASH = `0x${'1'.repeat(64)}`;

function lifecycleRows() {
	const base = { asset_symbol: 'ETH', group_id: 'g-eth', tx_hash: null as string | null };
	const chain = { tx_wallet_id: 'w1', tx_chain: 'ethereum' };
	return [
		{ ...base, direction: 'in', amount: 1, native_usd: 2_000, timestamp_utc: '2023-01-10T00:00:00Z', transaction_class: 'owned_acquisition', source_id: 'buy-1', source_type: 'import', import_source: 'coinbase', import_kind: 'Buy', import_account_id: 'acct-1' },
		{ ...base, direction: 'in', amount: 1, native_usd: 3_000, timestamp_utc: '2023-03-01T00:00:00Z', transaction_class: 'owned_acquisition', source_id: 'buy-2', source_type: 'import', import_source: 'coinbase', import_kind: 'Buy', import_account_id: 'acct-1' },
		{ ...base, direction: 'out', amount: 1, native_usd: 3_500, timestamp_utc: '2023-09-01T00:00:00Z', transaction_class: 'other', source_id: 'send-1', source_type: 'import', import_source: 'coinbase', import_kind: 'Send', import_account_id: 'acct-1', tx_hash: HASH },
		{ ...base, ...chain, direction: 'in', amount: 1, native_usd: 3_500, timestamp_utc: '2023-09-01T00:30:00Z', transaction_class: 'owned_acquisition', source_id: 'arrive-1', source_type: 'onchain', from_address: FAR, to_address: WALLET, tx_hash: HASH },
		{ ...base, ...chain, direction: 'out', amount: 1, native_usd: 4_000, timestamp_utc: '2023-11-01T00:00:00Z', transaction_class: 'other', source_id: 'pay-1', source_type: 'onchain', from_address: WALLET, to_address: FAR, tx_hash: `0x${'2'.repeat(64)}` },
		{ ...base, direction: 'out', amount: 0.5, native_usd: 1_500, timestamp_utc: '2024-04-01T00:00:00Z', transaction_class: 'other', source_id: 'sell-1', source_type: 'import', import_source: 'coinbase', import_kind: 'Sell', import_account_id: 'acct-1' },
		{ ...base, ...chain, direction: 'in', amount: 1, native_usd: 4_000, timestamp_utc: '2025-01-15T00:00:00Z', transaction_class: 'owned_acquisition', source_id: 'in-2', source_type: 'onchain', from_address: FAR, to_address: WALLET, tx_hash: `0x${'3'.repeat(64)}` },
		{ ...base, ...chain, direction: 'out', amount: 0.5, native_usd: 3_000, timestamp_utc: '2025-06-01T00:00:00Z', transaction_class: 'other', source_id: 'pay-2', source_type: 'onchain', from_address: WALLET, to_address: FAR, tx_hash: `0x${'4'.repeat(64)}` },
	];
}

function pipelineImports() {
	const base = { asset_symbol: 'ETH', to_amount: null, notes: null, category: null, description: null, source: 'coinbase', account_id: 'acct-1', wallet_id: null, import_batch_id: null };
	return [
		{ ...base, id: 'buy-1', timestamp_utc: '2023-01-10T00:00:00Z', direction: 'in', kind: 'Buy', amount: 1, native_usd: 2_000, tx_hash: null },
		{ ...base, id: 'buy-2', timestamp_utc: '2023-03-01T00:00:00Z', direction: 'in', kind: 'Buy', amount: 1, native_usd: 3_000, tx_hash: null },
		{ ...base, id: 'send-1', timestamp_utc: '2023-09-01T00:00:00Z', direction: 'out', kind: 'Send', amount: 1, native_usd: 3_500, tx_hash: HASH },
		{ ...base, id: 'sell-1', timestamp_utc: '2024-04-01T00:00:00Z', direction: 'out', kind: 'Sell', amount: 0.5, native_usd: 1_500, tx_hash: null },
	];
}
function pipelineOnchain() {
	const base = { token_symbol: 'ETH', chain: 'ethereum', wallet_address: WALLET, wallet_id: 'w1', token_decimals: 18 };
	const wei = (n: number) => String(BigInt(Math.round(n * 1e6)) * 10n ** 12n);
	return [
		{ ...base, id: 'arrive-1', timestamp: '2023-09-01T00:30:00Z', value: wei(1), from_address: FAR, to_address: WALLET, tx_type: 'incoming', usd_value: 3_500, hash: HASH },
		{ ...base, id: 'pay-1', timestamp: '2023-11-01T00:00:00Z', value: wei(1), from_address: WALLET, to_address: FAR, tx_type: 'outgoing', usd_value: 4_000, hash: `0x${'2'.repeat(64)}` },
		{ ...base, id: 'in-2', timestamp: '2025-01-15T00:00:00Z', value: wei(1), from_address: FAR, to_address: WALLET, tx_type: 'incoming', usd_value: 4_000, hash: `0x${'3'.repeat(64)}` },
		{ ...base, id: 'pay-2', timestamp: '2025-06-01T00:00:00Z', value: wei(0.5), from_address: WALLET, to_address: FAR, tx_type: 'outgoing', usd_value: 3_000, hash: `0x${'4'.repeat(64)}` },
	];
}

function setup(engine: 'lifecycle' | 'pipeline') {
	mockExecute.mockImplementation(({ sql }: { sql: string }) => {
		if (sql.includes('/* tax:source */')) return Promise.resolve({ rows: engine === 'pipeline' ? [{ one: 1 }] : [] });
		if (sql.includes('LEFT JOIN asset_lifecycle_groups')) return Promise.resolve({ rows: lifecycleRows() });
		if (sql.includes('tax_classifications tc')) return Promise.resolve({ rows: [] });
		// The owner classified the two on-chain payments as sales and the 2025 receipt as a purchase.
		if (sql.includes('FROM tax_classifications'))
			return Promise.resolve({
				rows: [['pay-1', 'sell'], ['pay-2', 'sell'], ['in-2', 'buy']].map(([id, category]) => ({ source_type: 'onchain', source_id: id, category, sub_category: null, confidence: 1, linked_tx_id: null, linked_source_type: null, asset_symbol: 'ETH', amount_usd: null, tax_year: 2025 })),
			});
		if (sql.includes('import_batch_id')) return Promise.resolve({ rows: pipelineImports() });
		if (sql.includes('FROM transactions t') && sql.includes('JOIN wallets')) return Promise.resolve({ rows: pipelineOnchain() });
		if (sql.includes('/* tax:wallets */') || sql.includes('SELECT address FROM wallets')) return Promise.resolve({ rows: [{ id: 'w1', address: WALLET }] });
		return Promise.resolve({ rows: [] });
	});
}

const sales = (xs: { buyDate: string; costUsd: number | null; gainLossUsd: number | null; walletKey?: string | null }[]) =>
	xs.map((x) => [x.buyDate.slice(0, 10), x.costUsd, x.gainLossUsd]);

describe.each(['lifecycle', 'pipeline'] as const)('the %s engine', (engine) => {
	beforeEach(() => {
		vi.resetAllMocks();
		setup(engine);
	});

	it('per wallet from 2025: the wallet sells its own coin, not the older one in the Coinbase account', async () => {
		const bd = await buildAnnualBreakdown(OWNER_TENANT_ID, 2025, 'fifo', undefined, engine);
		expect(bd.basisMethod).toBe('per_wallet_fifo_from_2025');
		expect(bd.rule).toBe('per_wallet');
		expect(sales(bd.shortTerm)).toEqual([['2025-01-15', 2_000, 1_000]]);
		expect(bd.longTerm).toEqual([]);
		expect(bd.shortTerm[0].walletKey).toBe(`ethereum:${WALLET}`);
		expect(bd.needsAttention).toEqual([]);
		// Left at the end of 2025: the Coinbase lot, and half of the wallet's coin.
		expect(bd.stillHolding.map((h) => [h.acquiredDate.slice(0, 10), h.costUsd, h.amount, h.walletKey])).toEqual([
			['2023-03-01', 1_500, 0.5, 'cex:coinbase:acct-1'],
			['2025-01-15', 2_000, 0.5, `ethereum:${WALLET}`],
		]);
	});

	it('a tenant outside the rollout keeps one pool: the same sale takes the oldest coin anywhere', async () => {
		const bd = await buildAnnualBreakdown(OUTSIDER, 2025, 'fifo', undefined, engine);
		expect(bd.basisMethod).toBe('universal_fifo');
		expect(bd.rule).toBe('universal');
		expect(sales(bd.longTerm)).toEqual([['2023-03-01', 1_500, 1_500]]);
		expect(bd.shortTerm).toEqual([]);
	});

	it('years before 2025 come out the same under either rule, and say which one they used', async () => {
		for (const year of [2023, 2024]) {
			const perWallet = await buildAnnualBreakdown(OWNER_TENANT_ID, year, 'fifo', undefined, engine);
			const pooled = await buildAnnualBreakdown(OUTSIDER, year, 'fifo', undefined, engine);
			expect(perWallet.rule).toBe('universal');
			expect(sales(perWallet.longTerm)).toEqual(sales(pooled.longTerm));
			expect(sales(perWallet.shortTerm)).toEqual(sales(pooled.shortTerm));
			expect(perWallet.stillHolding.map((h) => [h.acquiredDate, h.costUsd, h.amount])).toEqual(pooled.stillHolding.map((h) => [h.acquiredDate, h.costUsd, h.amount]));
			expect(perWallet.totals).toEqual(pooled.totals);
		}
	});
});

describe('both engines', () => {
	it('give the same sales, holdings and totals per wallet, in every year', async () => {
		const run = async (engine: 'lifecycle' | 'pipeline') => {
			vi.resetAllMocks();
			setup(engine);
			const out = [];
			for (const year of [2023, 2024, 2025]) {
				const bd = await buildAnnualBreakdown(OWNER_TENANT_ID, year, 'fifo', undefined, engine);
				out.push({
					year,
					long: sales(bd.longTerm),
					short: sales(bd.shortTerm),
					held: bd.stillHolding.map((h) => [h.acquiredDate.slice(0, 10), h.costUsd, h.amount, h.walletKey]),
					totals: [bd.totals.shortTermGain, bd.totals.longTermGain, bd.totals.heldCostBasis],
				});
			}
			return out;
		};
		expect(await run('pipeline')).toEqual(await run('lifecycle'));
	});
});
