/**
 * ledgerToTaxRows: the ledger's lots and sale slices as the rows pass 4 persists (tax_lots,
 * tax_disposals). Pure. Invented amounts.
 */

import { describe, it, expect } from 'vitest';
import { ledgerToTaxRows, runFifo } from '../../src/lib/yearEnd/pass4';
import { classifyImportTxPass1 } from '../../src/lib/yearEnd/pass1';
import type { ClassificationResult, RawImportTx } from '../../src/lib/yearEnd/types';

const row = (o: Partial<RawImportTx> & { id: string; timestamp_utc: string }): RawImportTx => ({
	asset_symbol: 'BTC', direction: 'in', kind: 'Buy', amount: 1, to_amount: null, native_usd: null, tx_hash: null,
	source: 'coinbase', notes: null, category: null, description: null, account_id: 'acct-1', ...o,
});
const classify = (rows: RawImportTx[]) => {
	const m = new Map<string, ClassificationResult>();
	for (const r of rows) {
		const c = classifyImportTxPass1(r);
		if (c) m.set(`import:${r.id}`, c);
	}
	return m;
};
const run = (rows: RawImportTx[]) => runFifo('t', rows, [], classify(rows));

describe('runFifo on the ledger', () => {
	it('a sale the lots cannot cover keeps the rest as an unmatched disposal, with its share of the proceeds', () => {
		const rows = [
			row({ id: 'b', timestamp_utc: '2023-01-01T00:00:00Z', amount: 1, native_usd: 10_000 }),
			row({ id: 's', timestamp_utc: '2023-06-01T00:00:00Z', direction: 'out', kind: 'Sell', amount: 4, native_usd: 80_000 }),
		];
		const { lots, disposals } = run(rows);
		expect(lots).toHaveLength(1);
		const matched = disposals.filter((d) => d.lotId !== 'unmatched');
		const unmatched = disposals.filter((d) => d.lotId === 'unmatched');
		expect(matched.map((d) => [d.quantity, d.proceedsUsd, d.costBasisUsd, d.gainLossUsd])).toEqual([[1, 20_000, 10_000, 10_000]]);
		expect(unmatched.map((d) => [d.quantity, d.proceedsUsd, d.costBasisUsd, d.gainLossUsd, d.sourceId])).toEqual([[3, 60_000, null, null, 's']]);
		// Nothing is dropped: the slices and the remainder add up to the sale.
		expect(disposals.reduce((a, d) => a + d.quantity, 0)).toBe(4);
		expect(disposals.reduce((a, d) => a + (d.proceedsUsd ?? 0), 0)).toBe(80_000);
	});

	it('a sale never consumes a lot acquired after it', () => {
		const rows = [
			row({ id: 's', timestamp_utc: '2023-01-01T00:00:00Z', direction: 'out', kind: 'Sell', amount: 1, native_usd: 20_000 }),
			row({ id: 'b', timestamp_utc: '2023-06-01T00:00:00Z', amount: 1, native_usd: 10_000 }),
		];
		const { lots, disposals } = run(rows);
		expect(disposals.map((d) => d.lotId)).toEqual(['unmatched']);
		expect(lots[0].remainingQty).toBe(1);
	});

	it('a partial sale leaves the lot open with its remaining quantity', () => {
		const rows = [
			row({ id: 'b', timestamp_utc: '2023-01-01T00:00:00Z', amount: 2, native_usd: 20_000 }),
			row({ id: 's', timestamp_utc: '2023-06-01T00:00:00Z', direction: 'out', kind: 'Sell', amount: 0.5, native_usd: 7_500 }),
		];
		const { lots } = run(rows);
		expect(lots[0]).toMatchObject({ quantity: 2, remainingQty: 1.5, costBasisUsd: 20_000, pricePerUnit: 10_000 });
		expect(lots[0].isExhausted).toBeUndefined();
	});

	it('a lot used up is marked exhausted; a priced arrival from nowhere is a transfer lot', () => {
		const rows = [
			row({ id: 'dep', timestamp_utc: '2023-01-01T00:00:00Z', kind: 'deposit', source: 'kraken', account_id: 'k1', native_usd: 5_000 }),
			row({ id: 's', timestamp_utc: '2023-06-01T00:00:00Z', direction: 'out', kind: 'Sell', amount: 1, native_usd: 7_000, source: 'kraken', account_id: 'k1' }),
		];
		const { lots, disposals } = run(rows);
		expect(lots).toMatchObject([{ lotType: 'transfer', isExhausted: true, remainingQty: 0, sourceType: 'import', sourceId: 'dep' }]);
		expect(disposals[0]).toMatchObject({ gainLossUsd: 2_000, isShortTerm: true, category: 'sell', sourceId: 's' });
	});

	it('gives every lot and disposal its own id, so one tenant\'s ids never collide with another\'s', () => {
		const rows = [
			row({ id: 'b', timestamp_utc: '2023-01-01T00:00:00Z', native_usd: 10_000 }),
			row({ id: 's', timestamp_utc: '2023-06-01T00:00:00Z', direction: 'out', kind: 'Sell', native_usd: 20_000 }),
		];
		const a = run(rows);
		const b = run(rows);
		const ids = [...a.lots, ...a.disposals, ...b.lots, ...b.disposals].map((x) => x.id);
		expect(new Set(ids).size).toBe(ids.length);
		expect(a.disposals[0].lotId).toBe(a.lots[0].id);
	});

	it('an unmatched send consumes the lot but writes no disposal', () => {
		const rows = [
			row({ id: 'b', timestamp_utc: '2023-01-01T00:00:00Z', native_usd: 10_000 }),
			row({ id: 'send', timestamp_utc: '2023-06-01T00:00:00Z', direction: 'out', kind: 'Send', native_usd: 20_000 }),
		];
		const { lots, disposals, findings } = run(rows);
		expect(disposals).toEqual([]);
		expect(lots[0]).toMatchObject({ remainingQty: 0, isExhausted: true });
		expect(findings.map((f) => f.reason)).toEqual(['unmatched_transfer']);
	});
});

describe('ledgerToTaxRows', () => {
	it('maps nothing to nothing', () => {
		expect(ledgerToTaxRows({ engineVersion: 'x', lots: [], slices: [], unmatched: [], findings: [], jan1: [], snapshots: [] }, new Map())).toEqual({ lots: [], disposals: [] });
	});
});
