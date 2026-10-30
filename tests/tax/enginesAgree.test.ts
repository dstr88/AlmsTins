/**
 * One history, two engines. The lifecycle engine (Bookkeeping, and every page for a tenant that has
 * not run the tax pipeline) and the pipeline engine (the owner's pages once classify has run) read
 * different tables and classify rows their own way, but they run the same lot ledger. A history
 * with a transfer between the owner's own accounts therefore has to come out the same through
 * both: the same sales, the same gains and terms, the same coins still held, and no sale on the
 * transfer. Invented amounts; the database is mocked.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildAnnualBreakdown } from '../../src/lib/annualBreakdown';
import { db } from '../../src/lib/db';

vi.mock('../../src/lib/db', () => ({ db: { execute: vi.fn() } }));
const mockExecute = db.execute as ReturnType<typeof vi.fn>;

const TENANT = 'tenant-1';
const WALLET = `0x${'a'.repeat(40)}`;
const FAR = `0x${'f'.repeat(40)}`;
const HASH = `0x${'1'.repeat(64)}`;

// ── The history ──────────────────────────────────────────────────────────────
//   2022-01-10  Coinbase buys 1 ETH for 2,000
//   2023-03-01  Coinbase buys 1 ETH for 3,000
//   2023-09-01  Coinbase sends 1 ETH to the owner's own wallet (arrives 30 minutes later, same hash)
//   2023-11-01  the wallet sends 1 ETH to someone else (a sale at 4,000)
//   2024-04-01  Coinbase sells 0.5 ETH for 1,500
// Moving the coin is not a sale. FIFO takes the January 2022 lot for the November sale (long-term,
// gain 2,000), then the March 2023 lot for half of the April 2024 sale (long-term, 1,500 - 1,500 = 0).

const EXPECTED_2023 = { long: [['2022-01-10', 2_000, 4_000, 2_000]], short: [] as unknown[][] };
const EXPECTED_2024 = { long: [['2023-03-01', 1_500, 1_500, 0]], short: [] as unknown[][] };
const HELD_END_2024 = [['2023-03-01', 1_500, 0.5]];

const rows = (xs: { buyDate: string; costUsd: number | null; proceedsUsd: number | null; gainLossUsd: number | null }[]) =>
	xs.map((x) => [x.buyDate.slice(0, 10), x.costUsd, x.proceedsUsd, x.gainLossUsd]);

// ── Lifecycle shape ──────────────────────────────────────────────────────────

function lifecycleRows() {
	const base = { asset_symbol: 'ETH', group_id: 'g-eth', tx_hash: null as string | null };
	return [
		{ ...base, direction: 'in', amount: 1, native_usd: 2_000, timestamp_utc: '2022-01-10T00:00:00Z', transaction_class: 'owned_acquisition', source_id: 'buy-1', source_type: 'import', import_source: 'coinbase', import_kind: 'Buy', import_account_id: 'acct-1' },
		{ ...base, direction: 'in', amount: 1, native_usd: 3_000, timestamp_utc: '2023-03-01T00:00:00Z', transaction_class: 'owned_acquisition', source_id: 'buy-2', source_type: 'import', import_source: 'coinbase', import_kind: 'Buy', import_account_id: 'acct-1' },
		{ ...base, direction: 'out', amount: 1, native_usd: 3_500, timestamp_utc: '2023-09-01T00:00:00Z', transaction_class: 'other', source_id: 'send-1', source_type: 'import', import_source: 'coinbase', import_kind: 'Send', import_account_id: 'acct-1', tx_hash: HASH },
		{ ...base, direction: 'in', amount: 1, native_usd: 3_500, timestamp_utc: '2023-09-01T00:30:00Z', transaction_class: 'owned_acquisition', source_id: 'arrive-1', source_type: 'onchain', tx_wallet_id: 'w1', tx_chain: 'ethereum', from_address: FAR, to_address: WALLET, tx_hash: HASH },
		{ ...base, direction: 'out', amount: 1, native_usd: 4_000, timestamp_utc: '2023-11-01T00:00:00Z', transaction_class: 'other', source_id: 'pay-1', source_type: 'onchain', tx_wallet_id: 'w1', tx_chain: 'ethereum', from_address: WALLET, to_address: FAR, tx_hash: `0x${'2'.repeat(64)}` },
		{ ...base, direction: 'out', amount: 0.5, native_usd: 1_500, timestamp_utc: '2024-04-01T00:00:00Z', transaction_class: 'other', source_id: 'sell-1', source_type: 'import', import_source: 'coinbase', import_kind: 'Sell', import_account_id: 'acct-1' },
	];
}

// ── Pipeline shape ───────────────────────────────────────────────────────────

function pipelineImports() {
	const base = { asset_symbol: 'ETH', to_amount: null, notes: null, category: null, description: null, source: 'coinbase', account_id: 'acct-1', wallet_id: null, import_batch_id: null };
	return [
		{ ...base, id: 'buy-1', timestamp_utc: '2022-01-10T00:00:00Z', direction: 'in', kind: 'Buy', amount: 1, native_usd: 2_000, tx_hash: null },
		{ ...base, id: 'buy-2', timestamp_utc: '2023-03-01T00:00:00Z', direction: 'in', kind: 'Buy', amount: 1, native_usd: 3_000, tx_hash: null },
		{ ...base, id: 'send-1', timestamp_utc: '2023-09-01T00:00:00Z', direction: 'out', kind: 'Send', amount: 1, native_usd: 3_500, tx_hash: HASH },
		{ ...base, id: 'sell-1', timestamp_utc: '2024-04-01T00:00:00Z', direction: 'out', kind: 'Sell', amount: 0.5, native_usd: 1_500, tx_hash: null },
	];
}
function pipelineOnchain() {
	const base = { token_symbol: 'ETH', chain: 'ethereum', wallet_address: WALLET, wallet_id: 'w1', token_decimals: 18 };
	return [
		{ ...base, id: 'arrive-1', timestamp: '2023-09-01T00:30:00Z', value: '1000000000000000000', from_address: FAR, to_address: WALLET, tx_type: 'incoming', usd_value: 3_500, hash: HASH },
		{ ...base, id: 'pay-1', timestamp: '2023-11-01T00:00:00Z', value: '1000000000000000000', from_address: WALLET, to_address: FAR, tx_type: 'outgoing', usd_value: 4_000, hash: `0x${'2'.repeat(64)}` },
	];
}

function setup(engine: 'lifecycle' | 'pipeline') {
	mockExecute.mockImplementation(({ sql }: { sql: string }) => {
		if (sql.includes('/* tax:source */')) return Promise.resolve({ rows: engine === 'pipeline' ? [{ one: 1 }] : [] });
		if (sql.includes('LEFT JOIN asset_lifecycle_groups')) return Promise.resolve({ rows: lifecycleRows() });
		if (sql.includes('tax_classifications tc')) return Promise.resolve({ rows: [] });
		// The owner classified the on-chain payment as a sale, as the pipeline cannot tell a payment from a transfer by itself.
		if (sql.includes('FROM tax_classifications'))
			return Promise.resolve({ rows: [{ source_type: 'onchain', source_id: 'pay-1', category: 'sell', sub_category: null, confidence: 1, linked_tx_id: null, linked_source_type: null, asset_symbol: 'ETH', amount_usd: null, tax_year: 2023 }] });
		if (sql.includes('import_batch_id')) return Promise.resolve({ rows: pipelineImports() });
		if (sql.includes('FROM transactions t') && sql.includes('JOIN wallets')) return Promise.resolve({ rows: pipelineOnchain() });
		if (sql.includes('/* tax:wallets */') || sql.includes('SELECT address FROM wallets')) return Promise.resolve({ rows: [{ id: 'w1', address: WALLET }] });
		return Promise.resolve({ rows: [] });
	});
}

describe.each(['lifecycle', 'pipeline'] as const)('the %s engine', (engine) => {
	beforeEach(() => {
		vi.resetAllMocks();
		setup(engine);
	});

	it('books no sale on the transfer and the sales it should, in the year of each', async () => {
		const y2023 = await buildAnnualBreakdown(TENANT, 2023, 'fifo', undefined, engine);
		expect(y2023.dataSource).toBe(engine);
		expect(rows(y2023.longTerm)).toEqual(EXPECTED_2023.long);
		expect(rows(y2023.shortTerm)).toEqual(EXPECTED_2023.short);
		expect(y2023.needsAttention).toEqual([]);
		const y2024 = await buildAnnualBreakdown(TENANT, 2024, 'fifo', undefined, engine);
		expect(rows(y2024.longTerm)).toEqual(EXPECTED_2024.long);
		expect(rows(y2024.shortTerm)).toEqual(EXPECTED_2024.short);
	});

	it('holds what is left with its original date and cost, and no second lot for the arrival', async () => {
		const y2023 = await buildAnnualBreakdown(TENANT, 2023, 'fifo', undefined, engine);
		// After the November sale: one ETH is left, the March 2023 lot.
		expect(y2023.stillHolding.map((h) => [h.acquiredDate.slice(0, 10), h.costUsd, h.amount])).toEqual([['2023-03-01', 3_000, 1]]);
		const y2024 = await buildAnnualBreakdown(TENANT, 2024, 'fifo', undefined, engine);
		expect(y2024.stillHolding.map((h) => [h.acquiredDate.slice(0, 10), h.costUsd, h.amount])).toEqual(HELD_END_2024);
	});

	it('reports a transfer paired by its transaction as needing no review', async () => {
		const y2023 = await buildAnnualBreakdown(TENANT, 2023, 'fifo', undefined, engine);
		expect(y2023.transferReviews).toEqual([]);
	});
});

describe('both engines', () => {
	it('give the same sales, holdings and totals for the same history', async () => {
		const run = async (engine: 'lifecycle' | 'pipeline') => {
			vi.resetAllMocks();
			setup(engine);
			const out = [];
			for (const year of [2022, 2023, 2024]) {
				const bd = await buildAnnualBreakdown(TENANT, year, 'fifo', undefined, engine);
				out.push({
					year,
					long: rows(bd.longTerm),
					short: rows(bd.shortTerm),
					held: bd.stillHolding.map((h) => [h.acquiredDate.slice(0, 10), h.costUsd, h.amount]),
					totals: [bd.totals.shortTermGain, bd.totals.longTermGain, bd.totals.heldCostBasis],
					attention: bd.needsAttention.length,
				});
			}
			return out;
		};
		expect(await run('pipeline')).toEqual(await run('lifecycle'));
	});
});
