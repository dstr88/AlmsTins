import { describe, expect, it, vi } from 'vitest';

// currentHoldings imports the database client; these tests use only its pure parts.
vi.mock('@/lib/db', () => ({ db: {} }));

import { buildTickerPriceMap } from '@/lib/aave/pricing';
import { currentCoinSymbol } from '@/lib/chains';
import { parseSnapshotHoldings } from '@/lib/currentHoldings';
import { walletTokenUsdPrice } from '@/lib/prices/walletTokenPricing';

/**
 * Decision D3 (Oct 25, 2026): Polygon's native coin is stored as POL. Snapshots written before
 * say MATIC. Both must price the same and read as one holding.
 */

describe('POL rename: prices', () => {
	// A ticker list like CoinPaprika's: POL listed, and a stale MATIC ticker further down.
	const prices = buildTickerPriceMap([
		{ symbol: 'POL', quotes: { USD: { price: 0.21 } } },
		{ symbol: 'MATIC', quotes: { USD: { price: 0.05 } } },
	]);

	it('a row stored as POL prices exactly like one stored as MATIC, from the POL ticker', () => {
		expect(walletTokenUsdPrice('POL', prices)).toBe(0.21);
		expect(walletTokenUsdPrice('MATIC', prices)).toBe(0.21);
		expect(walletTokenUsdPrice('pol', prices)).toBe(walletTokenUsdPrice('matic', prices));
	});

	it('with no POL ticker neither is priced (never a guess)', () => {
		const noPol = buildTickerPriceMap([{ symbol: 'MATIC', quotes: { USD: { price: 0.05 } } }]);
		expect(walletTokenUsdPrice('POL', noPol)).toBeNull();
		expect(walletTokenUsdPrice('MATIC', noPol)).toBeNull();
	});
});

describe('POL rename: snapshot readers', () => {
	it('currentCoinSymbol reads MATIC as POL and leaves everything else exactly as given', () => {
		expect(currentCoinSymbol('MATIC')).toBe('POL');
		expect(currentCoinSymbol(' matic ')).toBe('POL');
		expect(currentCoinSymbol('POL')).toBe('POL');
		expect(currentCoinSymbol('WMATIC')).toBe('WMATIC');
		expect(currentCoinSymbol('eth')).toBe('eth');
		expect(currentCoinSymbol('')).toBe('');
	});

	it('an old MATIC snapshot and a new POL snapshot are one holding', () => {
		const before = JSON.stringify([{ symbol: 'MATIC', amount: 40, valueUsd: 8 }]);
		const after = JSON.stringify([{ symbol: 'POL', amount: 10, valueUsd: 2 }, { symbol: 'ETH', amount: 1, valueUsd: 3 }]);
		const held = parseSnapshotHoldings([before, after]);
		expect(held.get('POL')).toEqual({ qty: 50, valueUsd: 10 });
		expect(held.has('MATIC')).toBe(false);
		expect(held.get('ETH')).toEqual({ qty: 1, valueUsd: 3 });
	});
});
