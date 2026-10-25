import { describe, it, expect } from 'vitest';
import { summarizeAddressHistory, type AddressHistoryRow } from '../../src/lib/addressHistory';

/**
 * Totals of the user's own transactions with one address: exact decimal sums, a USD total only
 * when every row it covers has one, failed transactions as zero.
 */

let n = 0;
function row(o: Partial<AddressHistoryRow>): AddressHistoryRow {
	n++;
	const sortKey = o.sortKey ?? `2025-01-${String(n).padStart(2, '0')}T00:00:00.000Z`;
	return {
		chain: 'ethereum',
		asset: 'ETH',
		direction: 'out',
		amount: '1',
		usdValue: '',
		failed: false,
		date: `${sortKey.slice(0, 10)} ${sortKey.slice(11, 19)}`,
		sortKey,
		...o,
	};
}

describe('summarizeAddressHistory', () => {
	it('no rows: no totals and no dates', () => {
		expect(summarizeAddressHistory([])).toEqual({ totals: [], firstDate: '', lastDate: '' });
	});

	it('one row', () => {
		const r = row({ direction: 'in', amount: '2.5', usdValue: '7500.25', sortKey: '2025-02-01T10:00:00.000Z' });
		expect(summarizeAddressHistory([r])).toEqual({
			totals: [{ asset: 'ETH', chain: 'ethereum', sent: '0', received: '2.5', count: 1, sentUsd: '', receivedUsd: '7500.25' }],
			firstDate: '2025-02-01 10:00:00',
			lastDate: '2025-02-01 10:00:00',
		});
	});

	it('adds decimals exactly, where floating point would not', () => {
		const { totals } = summarizeAddressHistory([
			row({ amount: '0.1', usdValue: '0.1' }),
			row({ amount: '0.2', usdValue: '0.2' }),
			row({ amount: '0.000000000000000001' }),
			row({ amount: '123456789012345678901234567890' }),
		]);
		expect(0.1 + 0.2).not.toBe(0.3);
		expect(totals[0].sent).toBe('123456789012345678901234567890.300000000000000001');
		// Two of the four rows have no USD value: no USD total.
		expect(totals[0].sentUsd).toBe('');
	});

	it('mixed assets and chains are kept apart, ordered by chain then asset', () => {
		const { totals } = summarizeAddressHistory([
			row({ chain: 'polygon', asset: 'USDC', direction: 'out', amount: '500', usdValue: '500' }),
			row({ chain: 'ethereum', asset: 'USDC', direction: 'in', amount: '10', usdValue: '10' }),
			row({ chain: 'polygon', asset: 'USDC', direction: 'out', amount: '700', usdValue: '700' }),
			row({ chain: 'polygon', asset: 'POL', direction: 'in', amount: '3.25', usdValue: '' }),
			row({ chain: 'ethereum', asset: 'ETH', direction: 'out', amount: '1.5', usdValue: '3000' }),
		]);
		expect(totals).toEqual([
			{ asset: 'ETH', chain: 'ethereum', sent: '1.5', received: '0', count: 1, sentUsd: '3000', receivedUsd: '' },
			{ asset: 'USDC', chain: 'ethereum', sent: '0', received: '10', count: 1, sentUsd: '', receivedUsd: '10' },
			{ asset: 'POL', chain: 'polygon', sent: '0', received: '3.25', count: 1, sentUsd: '', receivedUsd: '' },
			{ asset: 'USDC', chain: 'polygon', sent: '1200', received: '0', count: 2, sentUsd: '1200', receivedUsd: '' },
		]);
	});

	it('a failed row counts, but as zero, and does not erase the USD total', () => {
		const { totals } = summarizeAddressHistory([
			row({ amount: '1.5', usdValue: '3000' }),
			row({ amount: '0', usdValue: '', failed: true }),
			row({ amount: '2', usdValue: '5000', failed: true }),
		]);
		expect(totals).toEqual([{ asset: 'ETH', chain: 'ethereum', sent: '1.5', received: '0', count: 3, sentUsd: '3000', receivedUsd: '' }]);
	});

	it('a missing USD value on one row leaves that side out; the other side keeps its total', () => {
		const { totals } = summarizeAddressHistory([
			row({ direction: 'out', amount: '1', usdValue: '2000' }),
			row({ direction: 'out', amount: '1', usdValue: '' }),
			row({ direction: 'in', amount: '0.5', usdValue: '1000.5' }),
			row({ direction: 'in', amount: '0.25', usdValue: '500.25' }),
		]);
		expect(totals[0]).toMatchObject({ sent: '2', sentUsd: '', received: '0.75', receivedUsd: '1500.75' });
	});

	it('an amount that cannot be read leaves that total out instead of guessing', () => {
		const { totals } = summarizeAddressHistory([row({ amount: '1' }), row({ amount: '' })]);
		expect(totals[0]).toMatchObject({ sent: '', count: 2 });
	});

	it('a row with no direction is counted but in neither total', () => {
		const { totals } = summarizeAddressHistory([row({ direction: '', amount: '9', usdValue: '9' }), row({ direction: 'in', amount: '1', usdValue: '1' })]);
		expect(totals[0]).toMatchObject({ sent: '0', received: '1', count: 2, sentUsd: '', receivedUsd: '1' });
	});

	it('first and last dates come from the row times, whatever the order', () => {
		const s = summarizeAddressHistory([
			row({ sortKey: '2026-09-30T18:22:05.000Z' }),
			row({ sortKey: '2025-02-01T10:00:00.000Z' }),
			row({ sortKey: '2025-06-15T00:00:00.000Z' }),
		]);
		expect(s.firstDate).toBe('2025-02-01 10:00:00');
		expect(s.lastDate).toBe('2026-09-30 18:22:05');
	});
});
