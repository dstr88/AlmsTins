/**
 * Tests for pass3b — DeFi event classification.
 *
 * pass3b runs AFTER pass3 and only touches rows that are not yet classified.
 * It handles four categories:
 *   1. Rebase income      — OHM / GOHM / AMPL inbound rows
 *   2. LP deposit/withdrawal — keyword matching on kind/notes
 *   3. Wrapped token swap  — symbol-based (wBTC, stETH, WETH, …)
 *   4. Funding rate        — keyword matching on kind/notes
 *
 * For each branch we verify:
 *   - Correct category is assigned
 *   - Correct review reason is emitted
 *   - Correct confidence is set
 *   - Already-classified rows are skipped
 *   - Direction is respected where it matters (lp-deposit vs lp-withdrawal,
 *     funding income vs loan-interest-paid)
 */

import { describe, it, expect } from 'vitest';
import { classifyDeFiPass3b } from '../../src/lib/yearEnd/pass3b';
import {
	DEFI_LP_KEYWORDS,
	WRAPPED_TOKEN_MAP,
	REBASE_TOKEN_SYMBOLS,
	DEFI_FUNDING_KEYWORDS,
} from '../../src/lib/yearEnd/constants';
import type { RawImportTx } from '../../src/lib/yearEnd/types';

// ── Fixture helper ────────────────────────────────────────────────────────────

function row(overrides: Partial<RawImportTx> & { id: string }): RawImportTx {
	return {
		timestamp_utc: '2024-03-15T00:00:00Z',
		asset_symbol:  'ETH',
		direction:     'in',
		kind:          '',
		amount:        1,
		to_amount:     null,
		native_usd:    3_000,
		tx_hash:       null,
		source:        'coinbase',
		notes:         null,
		category:      null,
		...overrides,
	};
}

function noClassified(): Set<string> {
	return new Set<string>();
}

function classifiedSet(...ids: string[]): Set<string> {
	return new Set(ids.map((id) => `import:${id}`));
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. General behaviour
// ─────────────────────────────────────────────────────────────────────────────

describe('General behaviour', () => {
	it('returns empty arrays for an empty input', () => {
		const { results, reviewItems } = classifyDeFiPass3b([], noClassified());
		expect(results).toHaveLength(0);
		expect(reviewItems).toHaveLength(0);
	});

	it('skips a row that is already classified', () => {
		const rows = [row({ id: 'r1', asset_symbol: 'OHM', direction: 'in' })];
		const { results, reviewItems } = classifyDeFiPass3b(rows, classifiedSet('r1'));
		expect(results).toHaveLength(0);
		expect(reviewItems).toHaveLength(0);
	});

	it('classifies only unclassified rows when the set is mixed', () => {
		const rows = [
			row({ id: 'ohm1', asset_symbol: 'OHM', direction: 'in' }),
			row({ id: 'ohm2', asset_symbol: 'OHM', direction: 'in' }),
		];
		// ohm1 is already classified — only ohm2 should be processed
		const { results } = classifyDeFiPass3b(rows, classifiedSet('ohm1'));
		expect(results).toHaveLength(1);
		expect(results[0].sourceId).toBe('ohm2');
	});

	it('does not classify a plain unrecognised row', () => {
		const rows = [row({ id: 'plain', asset_symbol: 'BTC', kind: 'buy', notes: null })];
		const { results, reviewItems } = classifyDeFiPass3b(rows, noClassified());
		expect(results).toHaveLength(0);
		expect(reviewItems).toHaveLength(0);
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Rebase income — OHM / GOHM / AMPL
// ─────────────────────────────────────────────────────────────────────────────

describe('Rebase income', () => {
	it('classifies an inbound OHM row as rebase-income', () => {
		const rows = [row({ id: 'ohm1', asset_symbol: 'OHM', direction: 'in', native_usd: 50 })];
		const { results } = classifyDeFiPass3b(rows, noClassified());
		expect(results).toHaveLength(1);
		expect(results[0].category).toBe('rebase-income');
		expect(results[0].subCategory).toBe('ohm');
	});

	it('classifies an inbound GOHM row as rebase-income', () => {
		const rows = [row({ id: 'g1', asset_symbol: 'GOHM', direction: 'in', native_usd: 200 })];
		const { results } = classifyDeFiPass3b(rows, noClassified());
		expect(results[0].category).toBe('rebase-income');
		expect(results[0].subCategory).toBe('gohm');
	});

	it('classifies an inbound AMPL row as rebase-income', () => {
		const rows = [row({ id: 'a1', asset_symbol: 'AMPL', direction: 'in', native_usd: 10 })];
		const { results } = classifyDeFiPass3b(rows, noClassified());
		expect(results[0].category).toBe('rebase-income');
		expect(results[0].subCategory).toBe('ampl');
	});

	it('does NOT classify an outbound OHM row as rebase-income', () => {
		// Sending OHM out is not a rebase event — it might be a sell/transfer
		const rows = [row({ id: 'ohm-out', asset_symbol: 'OHM', direction: 'out' })];
		const { results } = classifyDeFiPass3b(rows, noClassified());
		expect(results).toHaveLength(0);
	});

	it('sets confidence to 0.75 for rebase income', () => {
		const rows = [row({ id: 'ohm2', asset_symbol: 'OHM', direction: 'in' })];
		const { results } = classifyDeFiPass3b(rows, noClassified());
		expect(results[0].confidence).toBe(0.75);
	});

	it('stores the correct USD amount and tax year', () => {
		const rows = [
			row({ id: 'ohm3', asset_symbol: 'OHM', direction: 'in',
				  native_usd: 123.45, timestamp_utc: '2024-07-04T00:00:00Z' }),
		];
		const { results } = classifyDeFiPass3b(rows, noClassified());
		expect(results[0].amountUsd).toBe(123.45);
		expect(results[0].taxYear).toBe(2024);
	});

	it('does NOT emit a review item when native_usd is present', () => {
		const rows = [row({ id: 'ohm4', asset_symbol: 'OHM', direction: 'in', native_usd: 99 })];
		const { reviewItems } = classifyDeFiPass3b(rows, noClassified());
		expect(reviewItems).toHaveLength(0);
	});

	it('emits a rebase_income_unpriced review item when native_usd is null', () => {
		const rows = [row({ id: 'ohm5', asset_symbol: 'OHM', direction: 'in', native_usd: null })];
		const { reviewItems } = classifyDeFiPass3b(rows, noClassified());
		expect(reviewItems).toHaveLength(1);
		expect(reviewItems[0].reason).toBe('rebase_income_unpriced');
		expect(reviewItems[0].sourceId).toBe('ohm5');
	});

	it('emits a rebase_income_unpriced review item when native_usd is 0', () => {
		// 0 is falsy — same code path as null
		const rows = [row({ id: 'ohm6', asset_symbol: 'OHM', direction: 'in', native_usd: 0 })];
		const { reviewItems } = classifyDeFiPass3b(rows, noClassified());
		expect(reviewItems).toHaveLength(1);
		expect(reviewItems[0].reason).toBe('rebase_income_unpriced');
	});

	it('covers every symbol in REBASE_TOKEN_SYMBOLS', () => {
		// Guard against constants.ts adding a new symbol without a test
		for (const sym of REBASE_TOKEN_SYMBOLS) {
			const rows = [row({ id: `rebase-${sym}`, asset_symbol: sym, direction: 'in', native_usd: 1 })];
			const { results } = classifyDeFiPass3b(rows, noClassified());
			expect(results[0].category, `${sym} should produce rebase-income`).toBe('rebase-income');
		}
	});

	it('is case-insensitive for asset symbol (lowercase ohm still matches)', () => {
		// The code uppercases the symbol before Set lookup — lowercase source data works
		const rows = [row({ id: 'ohm-lower', asset_symbol: 'ohm', direction: 'in', native_usd: 10 })];
		const { results } = classifyDeFiPass3b(rows, noClassified());
		expect(results[0].category).toBe('rebase-income');
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. LP deposit / withdrawal
// ─────────────────────────────────────────────────────────────────────────────

describe('LP deposit / withdrawal', () => {
	it('classifies a direction=out LP row as lp-deposit', () => {
		const rows = [
			row({ id: 'lp1', kind: 'add liquidity', direction: 'out', asset_symbol: 'ETH' }),
		];
		const { results } = classifyDeFiPass3b(rows, noClassified());
		expect(results[0].category).toBe('lp-deposit');
	});

	it('classifies a direction=in LP row as lp-withdrawal', () => {
		const rows = [
			row({ id: 'lp2', kind: 'remove liquidity', direction: 'in', asset_symbol: 'ETH' }),
		];
		const { results } = classifyDeFiPass3b(rows, noClassified());
		expect(results[0].category).toBe('lp-withdrawal');
	});

	it('always emits a possible_lp_event review item', () => {
		const rows = [row({ id: 'lp3', kind: 'liquidity', direction: 'out' })];
		const { reviewItems } = classifyDeFiPass3b(rows, noClassified());
		expect(reviewItems).toHaveLength(1);
		expect(reviewItems[0].reason).toBe('possible_lp_event');
	});

	it('sets confidence to 0.7', () => {
		const rows = [row({ id: 'lp4', kind: 'uniswap v3', direction: 'out' })];
		const { results } = classifyDeFiPass3b(rows, noClassified());
		expect(results[0].confidence).toBe(0.7);
	});

	it('matches "liquidity" in the kind field', () => {
		const rows = [row({ id: 'lp5', kind: 'liquidity pool', direction: 'out' })];
		const { results } = classifyDeFiPass3b(rows, noClassified());
		expect(results[0].category).toBe('lp-deposit');
	});

	it('matches LP keyword in the notes field', () => {
		const rows = [row({ id: 'lp6', kind: '', notes: 'pool deposit to Curve', direction: 'out' })];
		const { results } = classifyDeFiPass3b(rows, noClassified());
		expect(results[0].category).toBe('lp-deposit');
	});

	it('is case-insensitive for LP keyword matching', () => {
		const rows = [row({ id: 'lp7', kind: 'Add Liquidity', direction: 'out' })];
		const { results } = classifyDeFiPass3b(rows, noClassified());
		expect(results[0].category).toBe('lp-deposit');
	});

	it('covers every DEFI_LP_KEYWORDS entry', () => {
		for (const kw of DEFI_LP_KEYWORDS) {
			const rows = [row({ id: `lp-kw-${kw}`, kind: kw, direction: 'out' })];
			const { results } = classifyDeFiPass3b(rows, noClassified());
			expect(results[0].category, `keyword "${kw}" should produce lp-deposit`).toBe('lp-deposit');
		}
	});

	it('stores sourceType = import and sourceId correctly', () => {
		const rows = [row({ id: 'lp-src', kind: 'liquidity', direction: 'in' })];
		const { results } = classifyDeFiPass3b(rows, noClassified());
		expect(results[0].sourceType).toBe('import');
		expect(results[0].sourceId).toBe('lp-src');
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Wrapped token swap
// ─────────────────────────────────────────────────────────────────────────────

describe('Wrapped token swap', () => {
	it('classifies a WBTC row as wrapped-swap', () => {
		const rows = [row({ id: 'w1', asset_symbol: 'WBTC', kind: 'Convert' })];
		const { results } = classifyDeFiPass3b(rows, noClassified());
		expect(results[0].category).toBe('wrapped-swap');
	});

	it('classifies a WETH row as wrapped-swap', () => {
		const rows = [row({ id: 'w2', asset_symbol: 'WETH' })];
		const { results } = classifyDeFiPass3b(rows, noClassified());
		expect(results[0].category).toBe('wrapped-swap');
	});

	it('classifies STETH as wrapped-swap (stETH → ETH)', () => {
		const rows = [row({ id: 'w3', asset_symbol: 'STETH' })];
		const { results } = classifyDeFiPass3b(rows, noClassified());
		expect(results[0].category).toBe('wrapped-swap');
	});

	it('sets sub_category to the symbol-underlying pair', () => {
		const rows = [row({ id: 'w4', asset_symbol: 'WBTC' })];
		const { results } = classifyDeFiPass3b(rows, noClassified());
		expect(results[0].subCategory).toBe('wbtc-btc');
	});

	it('sets confidence to 0.7', () => {
		const rows = [row({ id: 'w5', asset_symbol: 'CBETH' })];
		const { results } = classifyDeFiPass3b(rows, noClassified());
		expect(results[0].confidence).toBe(0.7);
	});

	it('always emits a wrapped_token_swap review item', () => {
		const rows = [row({ id: 'w6', asset_symbol: 'RETH' })];
		const { reviewItems } = classifyDeFiPass3b(rows, noClassified());
		expect(reviewItems).toHaveLength(1);
		expect(reviewItems[0].reason).toBe('wrapped_token_swap');
	});

	it('covers every entry in WRAPPED_TOKEN_MAP', () => {
		for (const [sym] of WRAPPED_TOKEN_MAP) {
			const rows = [row({ id: `wrap-${sym}`, asset_symbol: sym })];
			const { results } = classifyDeFiPass3b(rows, noClassified());
			expect(results[0].category, `${sym} should produce wrapped-swap`).toBe('wrapped-swap');
		}
	});

	it('is case-insensitive for wrapped token symbol (lowercase wbtc matches)', () => {
		const rows = [row({ id: 'w-lower', asset_symbol: 'wbtc' })];
		const { results } = classifyDeFiPass3b(rows, noClassified());
		expect(results[0].category).toBe('wrapped-swap');
	});

	it('does NOT classify a plain BTC row as wrapped-swap', () => {
		const rows = [row({ id: 'btc1', asset_symbol: 'BTC' })];
		const { results } = classifyDeFiPass3b(rows, noClassified());
		expect(results).toHaveLength(0);
	});

	it('review item snapshotJson contains the underlying token', () => {
		const rows = [row({ id: 'w7', asset_symbol: 'WBTC' })];
		const { reviewItems } = classifyDeFiPass3b(rows, noClassified());
		const snap = JSON.parse(reviewItems[0].snapshotJson!);
		expect(snap.underlying).toBe('BTC');
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Funding rate payments
// ─────────────────────────────────────────────────────────────────────────────

describe('Funding rate payments', () => {
	it('classifies a direction=in funding-rate row as income', () => {
		const rows = [row({ id: 'fr1', kind: 'funding rate', direction: 'in' })];
		const { results } = classifyDeFiPass3b(rows, noClassified());
		expect(results[0].category).toBe('income');
		expect(results[0].subCategory).toBe('funding-rate');
	});

	it('classifies a direction=out funding-rate row as loan-interest-paid', () => {
		const rows = [row({ id: 'fr2', kind: 'funding rate', direction: 'out' })];
		const { results } = classifyDeFiPass3b(rows, noClassified());
		expect(results[0].category).toBe('loan-interest-paid');
		expect(results[0].subCategory).toBe('funding-rate');
	});

	it('sets confidence to 0.75 for funding rate', () => {
		const rows = [row({ id: 'fr3', kind: 'perp funding', direction: 'in' })];
		const { results } = classifyDeFiPass3b(rows, noClassified());
		expect(results[0].confidence).toBe(0.75);
	});

	it('always emits a funding_payment review item', () => {
		const rows = [row({ id: 'fr4', kind: 'perpetual funding', direction: 'in' })];
		const { reviewItems } = classifyDeFiPass3b(rows, noClassified());
		expect(reviewItems).toHaveLength(1);
		expect(reviewItems[0].reason).toBe('funding_payment');
	});

	it('matches funding keyword in the notes field', () => {
		const rows = [row({ id: 'fr5', kind: '', notes: 'margin interest charge', direction: 'out' })];
		const { results } = classifyDeFiPass3b(rows, noClassified());
		expect(results[0].category).toBe('loan-interest-paid');
	});

	it('is case-insensitive for funding keywords', () => {
		const rows = [row({ id: 'fr6', kind: 'Funding Rate', direction: 'in' })];
		const { results } = classifyDeFiPass3b(rows, noClassified());
		expect(results[0].category).toBe('income');
	});

	it('covers every DEFI_FUNDING_KEYWORDS entry', () => {
		for (const kw of DEFI_FUNDING_KEYWORDS) {
			const rows = [row({ id: `fr-kw-${kw}`, kind: kw, direction: 'in' })];
			const { results } = classifyDeFiPass3b(rows, noClassified());
			expect(results[0].category, `keyword "${kw}" should produce income`).toBe('income');
		}
	});

	it('stores sourceType = import and correct sourceId', () => {
		const rows = [row({ id: 'fr-src', kind: 'funding rate', direction: 'in' })];
		const { results } = classifyDeFiPass3b(rows, noClassified());
		expect(results[0].sourceType).toBe('import');
		expect(results[0].sourceId).toBe('fr-src');
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Pass priority — rebase fires before LP and wrapped checks
// ─────────────────────────────────────────────────────────────────────────────

describe('Check ordering / priority', () => {
	it('rebase check fires before LP keyword check (OHM + LP keyword → rebase-income)', () => {
		// An OHM row that also contains "liquidity" in kind should be caught by the
		// rebase branch first and NOT double-classified as lp-deposit.
		const rows = [
			row({ id: 'prio1', asset_symbol: 'OHM', direction: 'in', kind: 'liquidity pool rebase' }),
		];
		const { results } = classifyDeFiPass3b(rows, noClassified());
		expect(results).toHaveLength(1);
		expect(results[0].category).toBe('rebase-income');
	});

	it('LP check fires before wrapped token check', () => {
		// A WETH row whose kind contains an LP keyword — LP wins.
		const rows = [
			row({ id: 'prio2', asset_symbol: 'WETH', direction: 'out', kind: 'add liquidity' }),
		];
		const { results } = classifyDeFiPass3b(rows, noClassified());
		expect(results).toHaveLength(1);
		expect(results[0].category).toBe('lp-deposit');
	});

	it('wrapped token check fires before funding rate check', () => {
		// A WBTC row whose notes contain "funding rate" — wrapped-swap wins.
		const rows = [
			row({ id: 'prio3', asset_symbol: 'WBTC', direction: 'in', notes: 'funding rate payment' }),
		];
		const { results } = classifyDeFiPass3b(rows, noClassified());
		expect(results).toHaveLength(1);
		expect(results[0].category).toBe('wrapped-swap');
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. Tax year extraction
// ─────────────────────────────────────────────────────────────────────────────

describe('Tax year extraction', () => {
	it('extracts the correct year from a 2023 timestamp', () => {
		const rows = [
			row({ id: 'yr1', asset_symbol: 'OHM', direction: 'in',
				  timestamp_utc: '2023-12-31T23:59:59Z' }),
		];
		const { results } = classifyDeFiPass3b(rows, noClassified());
		expect(results[0].taxYear).toBe(2023);
	});

	it('extracts 2024 from a 2024 timestamp', () => {
		const rows = [
			row({ id: 'yr2', asset_symbol: 'AMPL', direction: 'in',
				  timestamp_utc: '2024-01-01T00:00:00Z' }),
		];
		const { results } = classifyDeFiPass3b(rows, noClassified());
		expect(results[0].taxYear).toBe(2024);
	});

	it('stores null taxYear for an invalid timestamp', () => {
		const rows = [
			row({ id: 'yr3', asset_symbol: 'OHM', direction: 'in',
				  timestamp_utc: 'not-a-date' }),
		];
		const { results } = classifyDeFiPass3b(rows, noClassified());
		expect(results[0].taxYear).toBeNull();
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. Edge cases
// ─────────────────────────────────────────────────────────────────────────────

describe('Edge cases', () => {
	it('handles null kind and null notes gracefully', () => {
		// No match expected — shouldn't throw
		const rows = [row({ id: 'null1', kind: null, notes: null, asset_symbol: 'ETH' })];
		expect(() => classifyDeFiPass3b(rows, noClassified())).not.toThrow();
		const { results } = classifyDeFiPass3b(rows, noClassified());
		expect(results).toHaveLength(0);
	});

	it('handles null asset_symbol gracefully (no rebase match)', () => {
		const rows = [row({ id: 'null2', asset_symbol: null, direction: 'in' })];
		expect(() => classifyDeFiPass3b(rows, noClassified())).not.toThrow();
		const { results } = classifyDeFiPass3b(rows, noClassified());
		expect(results).toHaveLength(0);
	});

	it('processes multiple rows independently', () => {
		const rows = [
			row({ id: 'm1', asset_symbol: 'OHM',  direction: 'in', native_usd: 10 }),
			row({ id: 'm2', asset_symbol: 'WBTC', direction: 'in', native_usd: 50 }),
			row({ id: 'm3', kind: 'add liquidity', direction: 'out' }),
		];
		const { results, reviewItems } = classifyDeFiPass3b(rows, noClassified());
		expect(results).toHaveLength(3);
		expect(reviewItems).toHaveLength(2); // WBTC + LP each emit a review item; OHM priced so no review
		const categories = results.map((r) => r.category);
		expect(categories).toContain('rebase-income');
		expect(categories).toContain('wrapped-swap');
		expect(categories).toContain('lp-deposit');
	});

	it('each result has the correct sourceType = import', () => {
		const rows = [
			row({ id: 'st1', asset_symbol: 'OHM',  direction: 'in' }),
			row({ id: 'st2', asset_symbol: 'WBTC' }),
			row({ id: 'st3', kind: 'liquidity', direction: 'out' }),
			row({ id: 'st4', kind: 'funding rate', direction: 'in' }),
		];
		const { results } = classifyDeFiPass3b(rows, noClassified());
		for (const r of results) {
			expect(r.sourceType).toBe('import');
		}
	});

	it('review item snapshotJson is valid JSON', () => {
		const rows = [
			row({ id: 'snap1', asset_symbol: 'WBTC' }),
			row({ id: 'snap2', kind: 'liquidity', direction: 'out' }),
			row({ id: 'snap3', kind: 'funding rate', direction: 'out' }),
		];
		const { reviewItems } = classifyDeFiPass3b(rows, noClassified());
		for (const item of reviewItems) {
			expect(() => JSON.parse(item.snapshotJson!)).not.toThrow();
		}
	});
});
