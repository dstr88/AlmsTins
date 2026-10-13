/**
 * Tests for pass3 — income and airdrop keyword classification.
 *
 * If "staking reward" stops matching the INCOME_KEYWORDS list, every staking
 * income event is silently dropped from Schedule 1 ordinary income — an
 * under-reporting error. Each keyword is tested explicitly.
 */

import { describe, it, expect } from 'vitest';
import { classifyIncomePass3, classifyFeesPass3 } from '../../src/lib/yearEnd/pass3';
import { INCOME_KEYWORDS, LOAN_INTEREST_KEYWORDS } from '../../src/lib/yearEnd/constants';
import type { RawImportTx, RawOnchainTx } from '../../src/lib/yearEnd/types';

// ── Fixture helpers ───────────────────────────────────────────────────────────

function importRow(overrides: Partial<RawImportTx> & { id: string }): RawImportTx {
	return {
		timestamp_utc: '2024-06-01T00:00:00Z',
		asset_symbol:  'ETH',
		direction:     'in',
		kind:          '',
		amount:        0.5,
		to_amount:     null,
		native_usd:    1_500,
		tx_hash:       null,
		source:        'coinbase',
		notes:         null,
		category:      null,
		...overrides,
	};
}

function onchainRow(overrides: Partial<RawOnchainTx> & { id: string }): RawOnchainTx {
	return {
		timestamp:    '2024-06-01T00:00:00Z',
		token_symbol: 'ETH',
		value:        '0',
		from_address: '0xabc',
		to_address:   '0xdef',
		tx_type:      'transfer',
		usd_value:    null,
		chain:        'ethereum',
		...overrides,
	};
}

const NO_CLASSIFIED = new Set<string>();

// ─────────────────────────────────────────────────────────────────────────────
// 1. AIRDROP DETECTION
// ─────────────────────────────────────────────────────────────────────────────

describe('Airdrop detection', () => {
	it('classifies "airdrop" in the kind field as "airdrop"', () => {
		const { results } = classifyIncomePass3(
			[importRow({ id: 'x', kind: 'Airdrop' })],
			NO_CLASSIFIED,
		);
		expect(results[0].category).toBe('airdrop');
	});

	it('classifies "airdrop" in the notes field as "airdrop"', () => {
		const { results } = classifyIncomePass3(
			[importRow({ id: 'x', kind: '', notes: 'ARB airdrop distribution' })],
			NO_CLASSIFIED,
		);
		expect(results[0].category).toBe('airdrop');
	});

	it('is case-insensitive for the airdrop keyword', () => {
		for (const variant of ['AIRDROP', 'Airdrop', 'airdrop', 'AirDrop']) {
			const { results } = classifyIncomePass3(
				[importRow({ id: 'x', kind: variant })],
				NO_CLASSIFIED,
			);
			expect(results[0]?.category, `variant="${variant}"`).toBe('airdrop');
		}
	});

	it('adds an airdrop_unpriced review item when native_usd is null', () => {
		const { results, reviewItems } = classifyIncomePass3(
			[importRow({ id: 'x', kind: 'Airdrop', native_usd: null })],
			NO_CLASSIFIED,
		);
		expect(results[0].category).toBe('airdrop');
		expect(reviewItems).toHaveLength(1);
		expect(reviewItems[0].reason).toBe('airdrop_unpriced');
		expect(reviewItems[0].sourceId).toBe('x');
	});

	it('does NOT add a review item when the airdrop is priced', () => {
		const { reviewItems } = classifyIncomePass3(
			[importRow({ id: 'x', kind: 'Airdrop', native_usd: 500 })],
			NO_CLASSIFIED,
		);
		expect(reviewItems).toHaveLength(0);
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. INCOME KEYWORD MATCHING
// ─────────────────────────────────────────────────────────────────────────────

describe('Income keyword matching', () => {
	it('classifies every INCOME_KEYWORD as "income" when present in kind', () => {
		for (const keyword of INCOME_KEYWORDS) {
			if (keyword === 'airdrop') continue; // handled separately above
			const { results } = classifyIncomePass3(
				[importRow({ id: 'x', kind: `Test ${keyword} event` })],
				NO_CLASSIFIED,
			);
			expect(results[0]?.category, `keyword="${keyword}"`).toBe('income');
		}
	});

	it('classifies "Staking Income" → income (real-world Coinbase kind)', () => {
		const { results } = classifyIncomePass3(
			[importRow({ id: 'x', kind: 'Staking Income' })],
			NO_CLASSIFIED,
		);
		expect(results[0].category).toBe('income');
		expect(results[0].subCategory).toBeDefined();
	});

	it('classifies "crypto_earn_interest_paid" → income (real-world CDC kind)', () => {
		const { results } = classifyIncomePass3(
			[importRow({ id: 'x', kind: 'crypto_earn_interest_paid' })],
			NO_CLASSIFIED,
		);
		expect(results[0].category).toBe('income');
	});

	it('sets confidence to 0.8 for income classifications', () => {
		const { results } = classifyIncomePass3(
			[importRow({ id: 'x', kind: 'Staking Reward' })],
			NO_CLASSIFIED,
		);
		expect(results[0].confidence).toBe(0.8);
	});

	it('does not classify outbound rows as income (direction check)', () => {
		const { results } = classifyIncomePass3(
			[importRow({ id: 'x', kind: 'Staking Reward', direction: 'out' })],
			NO_CLASSIFIED,
		);
		expect(results).toHaveLength(0);
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. LOAN INTEREST KEYWORDS
// ─────────────────────────────────────────────────────────────────────────────

describe('Loan interest keyword matching', () => {
	it('classifies every LOAN_INTEREST_KEYWORD as "loan-interest-paid"', () => {
		for (const keyword of LOAN_INTEREST_KEYWORDS) {
			const { results } = classifyIncomePass3(
				[importRow({ id: 'x', kind: keyword })],
				NO_CLASSIFIED,
			);
			expect(results[0]?.category, `keyword="${keyword}"`).toBe('loan-interest-paid');
		}
	});

	it('matches loan interest keyword in notes field', () => {
		const { results } = classifyIncomePass3(
			[importRow({ id: 'x', kind: '', notes: 'Monthly accrued interest payment' })],
			NO_CLASSIFIED,
		);
		expect(results[0]?.category).toBe('loan-interest-paid');
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. ALREADY CLASSIFIED ROWS ARE SKIPPED
// ─────────────────────────────────────────────────────────────────────────────

describe('Skip already-classified rows', () => {
	it('does not reclassify a row that is already in the classified set', () => {
		const row = importRow({ id: 'staking1', kind: 'Staking Income' });
		const alreadyClassified = new Set(['import:staking1']);
		const { results } = classifyIncomePass3([row], alreadyClassified);
		expect(results).toHaveLength(0);
	});

	it('classifies a row not in the classified set', () => {
		const row = importRow({ id: 'staking1', kind: 'Staking Income' });
		const { results } = classifyIncomePass3([row], NO_CLASSIFIED);
		expect(results).toHaveLength(1);
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. UNCLASSIFIABLE ROWS
// ─────────────────────────────────────────────────────────────────────────────

describe('Unclassifiable rows', () => {
	it('does not classify a row with no matching keyword', () => {
		const { results } = classifyIncomePass3(
			[importRow({ id: 'x', kind: 'random_unknown_kind_xyz', notes: null })],
			NO_CLASSIFIED,
		);
		expect(results).toHaveLength(0);
	});

	it('does not classify a row with empty kind and no notes', () => {
		const { results } = classifyIncomePass3(
			[importRow({ id: 'x', kind: '', notes: null })],
			NO_CLASSIFIED,
		);
		expect(results).toHaveLength(0);
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. FEE CLASSIFICATION (classifyFeesPass3)
// ─────────────────────────────────────────────────────────────────────────────

describe('Fee classification for onchain rows', () => {
	it('classifies tx_type="fee" as "fee"', () => {
		const results = classifyFeesPass3(
			[onchainRow({ id: 'x', tx_type: 'fee' })],
			NO_CLASSIFIED,
		);
		expect(results[0].category).toBe('fee');
		expect(results[0].confidence).toBe(0.9);
	});

	it('classifies tx_type="gas" as "fee"', () => {
		const results = classifyFeesPass3(
			[onchainRow({ id: 'x', tx_type: 'gas' })],
			NO_CLASSIFIED,
		);
		expect(results[0].category).toBe('fee');
	});

	it('does not classify a normal transfer as a fee', () => {
		const results = classifyFeesPass3(
			[onchainRow({ id: 'x', tx_type: 'transfer' })],
			NO_CLASSIFIED,
		);
		expect(results).toHaveLength(0);
	});

	it('skips already-classified rows', () => {
		const results = classifyFeesPass3(
			[onchainRow({ id: 'fee1', tx_type: 'fee' })],
			new Set(['onchain:fee1']),
		);
		expect(results).toHaveLength(0);
	});

	it('uses ETH as fallback symbol when token_symbol is null', () => {
		const results = classifyFeesPass3(
			[onchainRow({ id: 'x', tx_type: 'fee', token_symbol: null })],
			NO_CLASSIFIED,
		);
		expect(results[0].assetSymbol).toBe('ETH');
	});
});
